import "server-only";
import { appUrl } from "@/server/app-url";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities, donations, ledgerEntries, needs } from "@/server/db/schema";
import { cents, formatUsd, toCents, toPayPalValue } from "@/server/money";
import { PayPalError } from "@/server/paypal/client";
import { authorizeOrder, createHoldOrder, voidAuthorization } from "@/server/paypal/orders";
import { hashDonorKey, isWellFormedDonorKey, newDonorKey } from "./access";
import { giftAddedEmail, giftHeldEmail } from "./emails";
import { sendMail } from "@/server/mail/mailer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HONOR_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
export const MIN_DONATION_CENTS = 100;
// A gift waiting on PayPal approval reserves its amount for this long.
const RESERVATION_MINUTES = 15;
// Money actually promised to a need: holds placed and anything captured from them.
const HELD_STATUSES = ["authorized", "partially_captured", "captured"] as const;

export class DonationError extends Error {}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];


function parseAmount(raw: string): number {
  let c: number;
  try {
    c = toCents(raw.trim().replace(/^\$/, "").replace(/,/g, ""));
  } catch {
    throw new DonationError("Enter an amount like 25 or 25.50");
  }
  if (c < MIN_DONATION_CENTS) throw new DonationError("The smallest gift is $1.00");
  return c;
}

const heldOrReserved = (excludeId?: string) =>
  and(
    or(
      inArray(donations.status, [...HELD_STATUSES]),
      and(eq(donations.status, "pending_approval"), gt(donations.createdAt, sql`now() - make_interval(mins => ${RESERVATION_MINUTES})`)),
    ),
    excludeId ? ne(donations.id, excludeId) : undefined,
  );

/** Locks the need row; every check that decides "is there room for this gift" runs under this lock. */
async function lockNeed(tx: Tx, needId: string) {
  const [need] = await tx
    .select({
      id: needs.id,
      title: needs.title,
      amountCents: needs.amountCents,
      status: needs.status,
      deadline: needs.deadline,
      charityId: needs.charityId,
      merchantId: charities.paypalMerchantId,
      charityStatus: charities.status,
      receivable: charities.paymentsReceivable,
    })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(eq(needs.id, needId))
    .for("update", { of: needs });
  return need;
}

async function sumAmounts(tx: Tx, needId: string, where: ReturnType<typeof and>) {
  const [agg] = await tx
    .select({ total: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int` })
    .from(donations)
    .where(and(eq(donations.needId, needId), where));
  return agg?.total ?? 0;
}

/**
 * Step 1: reserve the amount, record the donation and create a PayPal order that
 * will HOLD the money for the charity. Returns PayPal's approval link.
 * Pass `topUpKey` to add another hold to a donor's existing gift on the same need.
 */
export async function startDonation(needId: string, rawAmount: string, topUpKey?: string): Promise<string> {
  if (!UUID.test(needId)) throw new DonationError("This need no longer exists.");
  const amountCents = parseAmount(rawAmount);

  let key: string;
  let hash: string;
  if (topUpKey !== undefined) {
    if (!isWellFormedDonorKey(topUpKey)) throw new DonationError("This gift link isn't valid.");
    key = topUpKey;
    hash = hashDonorKey(topUpKey);
  } else {
    ({ key, hash } = newDonorKey());
  }
  const db = getDb();

  const prepared = await db.transaction(async (tx) => {
    const need = await lockNeed(tx, needId);
    if (!need || need.status !== "open" || need.charityStatus !== "active" || !need.merchantId || !need.receivable) {
      throw new DonationError("This need isn't taking donations right now.");
    }
    if (need.deadline.getTime() < Date.now() + 60 * 60 * 1000) throw new DonationError("This need's deadline has passed.");
    if (topUpKey !== undefined) {
      // A top-up must belong to a gift this key already placed on this need.
      const [own] = await tx
        .select({ id: donations.id })
        .from(donations)
        .where(and(eq(donations.needId, need.id), eq(donations.donorAccessHash, hash), inArray(donations.status, [...HELD_STATUSES])))
        .limit(1);
      if (!own) throw new DonationError("You can add to a gift once its first hold is in place.");
    }

    const remaining = need.amountCents - (await sumAmounts(tx, need.id, heldOrReserved()));
    if (remaining < MIN_DONATION_CENTS) throw new DonationError("This need is covered. Thank you.");
    if (amountCents > remaining) throw new DonationError(`Only ${formatUsd(remaining)} is still needed.`);

    const [row] = await tx
      .insert(donations)
      .values({
        needId: need.id,
        charityId: need.charityId,
        amountCents,
        createRequestId: randomUUID(),
        donorAccessHash: hash,
        status: "pending_approval",
      })
      .returning({ id: donations.id, createRequestId: donations.createRequestId });
    return { donation: row!, need };
  });

  const { donation, need } = prepared;
  try {
    const order = await createHoldOrder({
      donationId: donation.id,
      requestId: donation.createRequestId,
      amountCents: cents(amountCents),
      charityMerchantId: need.merchantId!,
      description: need.title,
      returnUrl: `${appUrl()}/donate/return?k=${key}`,
      cancelUrl: `${appUrl()}/donate/cancel?k=${key}`,
    });
    await db.update(donations).set({ paypalOrderId: order.orderId }).where(eq(donations.id, donation.id));
    return order.approveUrl;
  } catch (e) {
    await db.update(donations).set({ status: "failed" }).where(eq(donations.id, donation.id));
    console.error("PayPal hold order failed", e instanceof PayPalError ? { status: e.status, name: e.errorName, issues: e.issues, debugId: e.debugId } : e instanceof Error ? e.message : e);
    throw e instanceof DonationError ? e : new DonationError("PayPal couldn't start the payment. Try again in a moment.");
  }
}

class FilledWhileAway extends Error {}

/**
 * Step 2: the donor approved on PayPal and came back. Under the need's lock,
 * check there is still room, place the hold, check PayPal holds exactly what we
 * asked for the right charity, then record it. Safe to run twice.
 */
export async function completeDonation(key: unknown, orderId: unknown): Promise<"held" | "already" | "failed" | "filled"> {
  if (!isWellFormedDonorKey(key) || typeof orderId !== "string") throw new DonationError("We couldn't match this PayPal approval to a donation.");
  const db = getDb();
  const [d] = await db
    .select({
      id: donations.id,
      status: donations.status,
      amountCents: donations.amountCents,
      needId: donations.needId,
      charityId: donations.charityId,
      merchantId: charities.paypalMerchantId,
    })
    .from(donations)
    .innerJoin(charities, eq(charities.id, donations.charityId))
    .where(and(eq(donations.donorAccessHash, hashDonorKey(key)), eq(donations.paypalOrderId, orderId)))
    .limit(1);
  if (!d) throw new DonationError("We couldn't match this PayPal approval to a donation.");
  if (d.status !== "pending_approval") return d.status === "failed" ? "failed" : "already";

  let placedAuthId: string | undefined;
  try {
    const result = await db.transaction(async (tx) => {
      const need = await lockNeed(tx, d.needId);
      if (!need || need.status !== "open") throw new FilledWhileAway();
      // Only real holds count here; reservations were already counted when gifts started.
      const held = await sumAmounts(tx, need.id, and(inArray(donations.status, [...HELD_STATUSES]), ne(donations.id, d.id)));
      if (held + d.amountCents > need.amountCents) throw new FilledWhileAway();

      // Re-read under the lock: a parallel request may have finished this gift.
      const [fresh] = await tx.select({ status: donations.status }).from(donations).where(eq(donations.id, d.id)).for("update");
      if (fresh?.status !== "pending_approval") return "already" as const;

      const auth = await authorizeOrder(orderId, d.id);
      placedAuthId = auth.authorizationId;
      if (auth.payeeMerchantId !== d.merchantId || auth.amountValue !== toPayPalValue(cents(d.amountCents)) || auth.referenceId !== d.id) {
        throw new DonationError("PayPal's hold didn't match this donation, so it wasn't recorded.");
      }
      await tx
        .update(donations)
        .set({
          status: "authorized",
          paypalAuthorizationId: auth.authorizationId,
          paypalPayerId: auth.payerId ?? null,
          donorEmail: auth.payerEmail ?? null,
          authorizedAt: auth.createTime,
          honorPeriodEndsAt: new Date(auth.createTime.getTime() + HONOR_PERIOD_MS),
          holdExpiresAt: auth.expirationTime ?? null,
        })
        .where(eq(donations.id, d.id));
      await tx.insert(ledgerEntries).values({
        charityId: d.charityId,
        donationId: d.id,
        event: "authorized",
        amountCents: d.amountCents,
        paypalReference: auth.authorizationId,
        actorType: "donor",
        details: { orderId },
      });
      return "held" as const;
    });
    if (result === "held") await emailDonorAboutHold(key, d.id);
    return result;
  } catch (e) {
    // A hold PayPal placed but we couldn't record must not stay on the donor's account.
    if (placedAuthId && d.merchantId) {
      await voidAuthorization(placedAuthId, d.merchantId, `${d.id}-void`).catch((ve) =>
        console.error("Could not cancel an unrecorded hold - needs manual follow-up", { donationId: d.id, error: ve instanceof Error ? ve.message : ve }),
      );
    }
    // Nothing was recorded; make sure the gift doesn't keep a reservation.
    await db.update(donations).set({ status: "failed" }).where(and(eq(donations.id, d.id), eq(donations.status, "pending_approval")));
    if (e instanceof FilledWhileAway) return "filled";
    if (e instanceof PayPalError) {
      console.error("PayPal authorize failed", { status: e.status, name: e.errorName, issues: e.issues, debugId: e.debugId });
      return "failed";
    }
    throw e;
  }
}

/** The donor cancelled on PayPal: nothing was held. Returns where to send them. */
export async function cancelDonation(key: unknown, orderId: unknown): Promise<{ needId?: string; hasGift: boolean }> {
  if (!isWellFormedDonorKey(key)) return { hasGift: false };
  const hash = hashDonorKey(key);
  const db = getDb();
  const match = typeof orderId === "string" ? and(eq(donations.donorAccessHash, hash), eq(donations.paypalOrderId, orderId)) : eq(donations.donorAccessHash, hash);
  const [row] = await db
    .update(donations)
    .set({ status: "failed" })
    .where(and(match, eq(donations.status, "pending_approval")))
    .returning({ needId: donations.needId });
  const [held] = await db
    .select({ needId: donations.needId })
    .from(donations)
    .where(and(eq(donations.donorAccessHash, hash), inArray(donations.status, [...HELD_STATUSES])))
    .limit(1);
  return { needId: row?.needId ?? held?.needId, hasGift: Boolean(held) };
}

/** What a donor's gift page shows: every hold placed with this private link. */
export async function getGiftForDonor(key: unknown) {
  if (!isWellFormedDonorKey(key)) return undefined;
  const db = getDb();
  const rows = await db
    .select({
      status: donations.status,
      amountCents: donations.amountCents,
      capturedCents: donations.capturedCents,
      refundedCents: donations.refundedCents,
      authorizedAt: donations.authorizedAt,
      holdExpiresAt: donations.holdExpiresAt,
      createdAt: donations.createdAt,
      donorEmail: donations.donorEmail,
      needId: needs.id,
      needTitle: needs.title,
      needStatus: needs.status,
      needAmountCents: needs.amountCents,
      deadline: needs.deadline,
      requiredProof: needs.requiredProof,
      charityName: charities.name,
    })
    .from(donations)
    .innerJoin(needs, and(eq(needs.id, donations.needId), eq(needs.charityId, donations.charityId)))
    .innerJoin(charities, eq(charities.id, donations.charityId))
    .where(eq(donations.donorAccessHash, hashDonorKey(key)))
    .orderBy(asc(donations.createdAt));
  if (rows.length === 0) return undefined;

  const first = rows[0]!;
  const placed = rows.filter((r) => (HELD_STATUSES as readonly string[]).includes(r.status) || r.status === "voided" || r.status === "expired");
  const giftCents = placed.reduce((s, r) => s + r.amountCents, 0);
  const chargedCents = placed.reduce((s, r) => s + r.capturedCents, 0);
  const refundedCents = placed.reduce((s, r) => s + r.refundedCents, 0);
  const heldCents = placed
    .filter((r) => r.status === "authorized" || r.status === "partially_captured")
    .reduce((s, r) => s + r.amountCents - r.capturedCents, 0);
  const expiries = placed.map((r) => r.holdExpiresAt).filter((x): x is Date => Boolean(x));

  // What the donor sees follows the need: open -> in review -> proven, or closed.
  const needClosed = ["proven", "not_proven", "cancelled"].includes(first.needStatus);
  let status: string;
  if (placed.length === 0) status = rows.some((r) => r.status === "pending_approval") ? "pending_approval" : "failed";
  else if (chargedCents > 0 && refundedCents === chargedCents && heldCents === 0) status = "refunded";
  else if (first.needStatus === "proven" && heldCents === 0) status = "proven";
  else if (needClosed && heldCents > 0) status = "closing";
  else if (needClosed || heldCents === 0) status = chargedCents > 0 ? "closed_after_advance" : "voided";
  else if (first.needStatus === "in_review") status = "in_review";
  else status = chargedCents > 0 ? "advance" : "authorized";

  // Room left on the need, for the "add to your gift" box.
  const [agg] = await db
    .select({ total: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int` })
    .from(donations)
    .where(and(eq(donations.needId, first.needId), heldOrReserved()));
  const remainingCents = Math.max(0, first.needAmountCents - (agg?.total ?? 0));

  return {
    status,
    giftCents,
    chargedCents,
    refundedCents,
    heldCents,
    holdExpiresAt: expiries.length ? new Date(Math.min(...expiries.map((x) => x.getTime()))) : undefined,
    holds: placed.map((r) => ({ amountCents: r.amountCents, status: r.status, at: r.authorizedAt ?? r.createdAt })),
    needId: first.needId,
    needTitle: first.needTitle,
    needStatus: first.needStatus,
    deadline: first.deadline,
    requiredProof: first.requiredProof,
    charityName: first.charityName,
    remainingCents,
    emailedTo: rows.find((r) => r.donorEmail)?.donorEmail ?? undefined,
    canTopUp: first.needStatus === "open" && heldCents > 0 && remainingCents >= MIN_DONATION_CENTS,
  };
}

/** Gifts started but not yet approved on PayPal - each holds its place for the reservation window. */
export async function reservedForNeed(needId: string): Promise<number> {
  if (!UUID.test(needId)) return 0;
  const [agg] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int` })
    .from(donations)
    .where(
      and(
        eq(donations.needId, needId),
        eq(donations.status, "pending_approval"),
        gt(donations.createdAt, sql`now() - make_interval(mins => ${RESERVATION_MINUTES})`),
      ),
    );
  return agg?.total ?? 0;
}

/** Room left on a need for new gifts (held + reserved amounts subtracted). */
export async function remainingForNeed(needId: string): Promise<number> {
  if (!UUID.test(needId)) return 0;
  const db = getDb();
  const [need] = await db.select({ amount: needs.amountCents }).from(needs).where(eq(needs.id, needId)).limit(1);
  if (!need) return 0;
  const [agg] = await db
    .select({ total: sql<number>`coalesce(sum(${donations.amountCents}), 0)::int` })
    .from(donations)
    .where(and(eq(donations.needId, needId), heldOrReserved()));
  return Math.max(0, need.amount - (agg?.total ?? 0));
}

/**
 * Emails the donor their private gift link once a hold is placed: "gift held"
 * for the first hold on this link, "gift added" for a top-up. Never blocks the
 * gift - a failed email is logged and the donor still has the page.
 */
async function emailDonorAboutHold(key: string, donationId: string): Promise<void> {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        email: donations.donorEmail,
        amountCents: donations.amountCents,
        holdExpiresAt: donations.holdExpiresAt,
        hash: donations.donorAccessHash,
        needTitle: needs.title,
        deadline: needs.deadline,
        charityName: charities.name,
      })
      .from(donations)
      .innerJoin(needs, and(eq(needs.id, donations.needId), eq(needs.charityId, donations.charityId)))
      .innerJoin(charities, eq(charities.id, donations.charityId))
      .where(eq(donations.id, donationId))
      .limit(1);
    if (!row?.email) return;
    const holds = await db
      .select({ id: donations.id, amountCents: donations.amountCents })
      .from(donations)
      .where(and(eq(donations.donorAccessHash, row.hash), inArray(donations.status, [...HELD_STATUSES])));
    const facts = {
      to: row.email,
      donationId,
      link: `${appUrl()}/d/${key}`,
      amountCents: row.amountCents,
      totalCents: holds.reduce((s, h) => s + h.amountCents, 0),
      needTitle: row.needTitle,
      charityName: row.charityName,
      deadline: row.deadline,
      holdExpiresAt: row.holdExpiresAt ?? undefined,
    };
    await sendMail(holds.length > 1 ? giftAddedEmail(facts) : giftHeldEmail(facts));
  } catch (e) {
    console.error("Gift email failed", { donationId, error: e instanceof Error ? e.message : e });
  }
}
