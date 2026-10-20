import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { appUrl } from "@/server/app-url";
import type { CharityContext, ReviewerContext } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { charities, donations, messages, needs, proofs, releases, supplierConfirmations, supplierPayments, suppliers } from "@/server/db/schema";
import { reviewerCharityScope } from "@/server/auth/scope";
import { sendMail } from "@/server/mail/mailer";
import { requestMissingConfirmations, requestSupplierConfirmation } from "./confirmations";
import { cents, formatUsd, toCents } from "@/server/money";
import { getEnv } from "@/server/env";
import { PayPalError } from "@/server/paypal/client";
import {
  captureSupplierPaymentOrder,
  connectedMerchant,
  createSupplierConnectLink,
  createSupplierPaymentOrder,
  getSupplierPaymentOrder,
  supplierCaptureStatus,
} from "@/server/paypal/suppliers";

export class SupplierError extends Error {}

/** The same supplier, amount and purchase was already paid today - the charity confirms before paying again. */
export class DuplicateSupplierPayment extends SupplierError {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const PAYABLE_NEED = ["open", "funded", "delivering", "in_review"];
const MAX_INVITES_PER_DAY = 20;
const MAX_INVITES_PER_EMAIL_PER_DAY = 3;

/** Payments that hold part of a need's cost: completed, or with a capture already requested from PayPal. */
const COMMITTED = or(eq(supplierPayments.status, "completed"), and(eq(supplierPayments.status, "created"), isNotNull(supplierPayments.captureRequestedAt)))!;

/** The signed-in charity, re-read from the database: suspended charities can't move money. */
async function charityFor(ctx: CharityContext) {
  const [c] = await getDb()
    .select({ id: charities.id, name: charities.name, status: charities.status, merchantId: charities.paypalMerchantId, isDemo: charities.isDemo })
    .from(charities)
    .where(eq(charities.id, ctx.charityId))
    .limit(1);
  if (!c) throw new SupplierError("Charity not found.");
  if (c.status !== "active" || !c.merchantId) throw new SupplierError("Your charity's account is on hold. Contact Proven.");
  return { ...c, merchantId: c.merchantId };
}

/**
 * A charity asks a supplier to connect PayPal to Proven, so the charity can pay it
 * through Proven. The supplier gets a one-time link (in the demo inbox) and
 * connects its own PayPal business account - no Proven account.
 */
export async function inviteSupplier(ctx: CharityContext, input: { name: string; email: string }): Promise<{ supplierId: string; status: "invited" | "connected" }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 80) throw new SupplierError("Give the supplier's business name.");
  if (!EMAIL.test(email)) throw new SupplierError("Enter the email of the supplier's PayPal business account.");
  const charity = await charityFor(ctx);
  const db = getDb();

  // Every invite counts, re-invites included: each one is a PayPal call and an email.
  const since = new Date(Date.now() - 86_400_000);
  const [{ total = 0, toThis = 0 } = {}] = await db
    .select({ total: sql<number>`count(*)::int`, toThis: sql<number>`count(*) filter (where ${messages.toEmail} = ${email})::int` })
    .from(messages)
    .where(and(eq(messages.charityId, charity.id), eq(messages.kind, "supplier_invite"), gt(messages.createdAt, since)));
  if (total >= MAX_INVITES_PER_DAY) throw new SupplierError("You've invited a lot of suppliers today. Try again tomorrow.");
  if (toThis >= MAX_INVITES_PER_EMAIL_PER_DAY) throw new SupplierError("You've already invited this supplier today. Ask them to use the link in their email.");

  const pick = { id: suppliers.id, status: suppliers.status, trackingId: suppliers.paypalTrackingId, name: suppliers.name, invitedBy: suppliers.invitedByCharityId };
  const samePool = and(eq(suppliers.paypalEmail, email), eq(suppliers.isDemo, charity.isDemo));
  // Two invites at once: the unique (email, pool) key keeps one row, and both read it back.
  await db
    .insert(suppliers)
    .values({ name, paypalEmail: email, paypalTrackingId: `proven-supplier-${randomUUID()}`, isDemo: charity.isDemo, invitedByCharityId: charity.id })
    .onConflictDoNothing({ target: [suppliers.paypalEmail, suppliers.isDemo] });
  const [supplier] = await db.select(pick).from(suppliers).where(samePool).limit(1);
  if (!supplier) throw new SupplierError("Couldn't save the supplier. Try again.");
  if (supplier.status === "connected") return { supplierId: supplier.id, status: "connected" };
  if (supplier.invitedBy !== charity.id) throw new SupplierError("This supplier has already been invited. They show up here once they connect PayPal.");

  const link = await createSupplierConnectLink(supplier.trackingId, `${appUrl()}/suppliers/connected?s=${supplier.id}`);
  await sendMail({
    kind: "supplier_invite",
    to: email,
    charityId: charity.id,
    subject: `${charity.name} wants to pay ${supplier.name} with PayPal on Proven`,
    text: [
      `${charity.name} buys disaster-relief supplies on Proven and wants to pay ${supplier.name} with PayPal.`,
      "",
      "Connect your PayPal business account once, and charities on Proven can pay you straight to PayPal - Proven never holds the money.",
      "",
      `Connect PayPal: ${link}`,
      "",
      "You'll sign in to PayPal and approve the connection. You do not need to create a Proven account.",
      "",
      "- Proven (PayPal sandbox demo - no real money moves)",
    ].join("\n"),
  });
  return { supplierId: supplier.id, status: "invited" };
}

/**
 * Checks with PayPal whether an invited supplier has connected. Guards: the
 * connected account must be the one invited, able to receive payments, and not
 * a charity's own account (a charity can't pay itself through a "supplier").
 */
export async function refreshSupplier(supplierId: string): Promise<"invited" | "connected"> {
  if (!UUID.test(supplierId)) return "invited";
  const db = getDb();
  const [s] = await db
    .select({ id: suppliers.id, status: suppliers.status, trackingId: suppliers.paypalTrackingId, email: suppliers.paypalEmail })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  if (!s) return "invited";
  if (s.status === "connected") return "connected";
  const m = await connectedMerchant(s.trackingId);
  if (!m || !m.paymentsReceivable) return "invited";
  // The account that connected must be the invited one, with its email confirmed by PayPal.
  // No email from PayPal means we can't tell, so it doesn't connect.
  if (!m.primaryEmail || !m.primaryEmailConfirmed || m.primaryEmail.toLowerCase() !== s.email) {
    console.error("Supplier connected with a PayPal account we can't match to the invite", { supplierId, hasEmail: Boolean(m.primaryEmail), confirmed: m.primaryEmailConfirmed });
    return "invited";
  }
  const [charityAccount] = await db.select({ id: charities.id }).from(charities).where(eq(charities.paypalMerchantId, m.merchantId)).limit(1);
  if (charityAccount || m.merchantId === getEnv().PAYPAL_PARTNER_MERCHANT_ID) {
    console.error("Supplier PayPal account belongs to a charity or the platform - refused", { supplierId });
    return "invited";
  }
  try {
    await db
      .update(suppliers)
      .set({ status: "connected", paypalMerchantId: m.merchantId, connectedAt: new Date(), paypalLegalName: m.legalName, paypalCountry: m.country })
      .where(and(eq(suppliers.id, s.id), eq(suppliers.status, "invited")));
  } catch (e) {
    // This PayPal account is already a connected supplier under another invite.
    if ((e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") return "invited";
    throw e;
  }
  return "connected";
}

/** "Check again" from the charity that sent the invite: only its own invites. */
export async function refreshInvitedSupplier(ctx: CharityContext, supplierId: string): Promise<"invited" | "connected"> {
  if (!UUID.test(supplierId)) return "invited";
  const [s] = await getDb()
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.invitedByCharityId, ctx.charityId)))
    .limit(1);
  return s ? refreshSupplier(s.id) : "invited";
}

export type SupplierView = {
  id: string;
  name: string;
  status: "invited" | "connected" | "rejected";
  email: string | null;
  paypalName: string | null;
  country: string | null;
  verified: boolean;
};

/**
 * Suppliers a charity can see: verified ones (same demo/real pool), plus the
 * ones it invited itself. An unverified supplier stays private to its inviter, so
 * a look-alike account can't be offered to other charities.
 */
export async function listSuppliersForCharity(ctx: CharityContext): Promise<SupplierView[]> {
  const charity = await charityFor(ctx);
  const rows = await getDb()
    .select({
      id: suppliers.id,
      name: suppliers.name,
      status: suppliers.status,
      email: suppliers.paypalEmail,
      invitedBy: suppliers.invitedByCharityId,
      paypalName: suppliers.paypalLegalName,
      country: suppliers.paypalCountry,
      verifiedAt: suppliers.verifiedAt,
    })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.isDemo, charity.isDemo),
        or(and(eq(suppliers.status, "connected"), isNotNull(suppliers.verifiedAt)), eq(suppliers.invitedByCharityId, charity.id)),
      ),
    )
    .orderBy(suppliers.name);
  // A supplier's email is shown only to the charity that invited it.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    email: r.invitedBy === charity.id ? r.email : null,
    paypalName: r.paypalName,
    country: r.country,
    verified: r.verifiedAt !== null,
  }));
}

/**
 * The charity starts paying a connected supplier for one of its own needs. Returns
 * PayPal's approval link; the charity approves with its own PayPal account.
 */
export async function startSupplierPayment(
  ctx: CharityContext,
  needId: string,
  input: { supplierId: string; amount: string; description: string; confirmRepeat?: boolean },
): Promise<{ approveUrl: string }> {
  if (!UUID.test(needId) || !UUID.test(input.supplierId)) throw new SupplierError("Choose a supplier.");
  let amountCents: number;
  try {
    amountCents = toCents(input.amount.replace(/[$,\s]/g, ""));
  } catch {
    throw new SupplierError("Enter an amount like 209.72.");
  }
  if (amountCents < 100) throw new SupplierError("Enter at least $1.00.");
  const description = input.description.trim().replace(/\s+/g, " ");
  if (description.length < 3 || description.length > 120) throw new SupplierError("Say what you're buying, in a few words.");

  const charity = await charityFor(ctx);
  const db = getDb();
  const payment = await db.transaction(async (tx) => {
    const [need] = await tx
      .select({ id: needs.id, title: needs.title, status: needs.status, amountCents: needs.amountCents })
      .from(needs)
      .where(and(eq(needs.id, needId), eq(needs.charityId, charity.id)))
      .for("update");
    if (!need) throw new SupplierError("Need not found.");
    if (!PAYABLE_NEED.includes(need.status)) throw new SupplierError("This need is closed.");

    const [supplier] = await tx
      .select({ id: suppliers.id, name: suppliers.name, merchantId: suppliers.paypalMerchantId, status: suppliers.status, verifiedAt: suppliers.verifiedAt, invitedBy: suppliers.invitedByCharityId })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.isDemo, charity.isDemo)))
      .limit(1);
    // An unverified supplier can only be paid by the charity that invited it.
    if (!supplier || (!supplier.verifiedAt && supplier.invitedBy !== charity.id)) throw new SupplierError("Supplier not found.");
    if (supplier.status === "rejected") throw new SupplierError(`${supplier.name} can't be paid through Proven.`);
    if (supplier.status !== "connected" || !supplier.merchantId) throw new SupplierError(`${supplier.name} hasn't connected PayPal yet.`);
    // A supplier must never be a charity's own PayPal account (checked again here: charities can join later).
    const [charityAccount] = await tx.select({ id: charities.id }).from(charities).where(eq(charities.paypalMerchantId, supplier.merchantId)).limit(1);
    if (charityAccount || supplier.merchantId === getEnv().PAYPAL_PARTNER_MERCHANT_ID) throw new SupplierError("This supplier can't be paid through Proven. Contact Proven.");

    // Payments for a need can't add up to more than the need costs.
    const [{ used = 0 } = {}] = await tx
      .select({ used: sql<number>`coalesce(sum(${supplierPayments.amountCents}), 0)::int` })
      .from(supplierPayments)
      .where(
        and(
          eq(supplierPayments.needId, need.id),
          or(COMMITTED, and(eq(supplierPayments.status, "created"), gt(supplierPayments.createdAt, new Date(Date.now() - 3_600_000)))),
        ),
      );
    if (used + amountCents > need.amountCents) throw new SupplierError(`Payments for this need can't go over its ${formatUsd(need.amountCents)} cost.`);

    // Paying the same supplier the same amount for the same thing twice in a day is usually a
    // mistake (a slow PayPal page, a second tab): ask first, under the need's lock.
    if (!input.confirmRepeat) {
      const [repeat] = await tx
        .select({ id: supplierPayments.id })
        .from(supplierPayments)
        .where(
          and(
            eq(supplierPayments.needId, need.id),
            eq(supplierPayments.supplierId, supplier.id),
            eq(supplierPayments.amountCents, amountCents),
            sql`lower(${supplierPayments.description}) = lower(${description})`,
            gt(supplierPayments.createdAt, new Date(Date.now() - 86_400_000)),
            or(COMMITTED, and(eq(supplierPayments.status, "created"), gt(supplierPayments.createdAt, new Date(Date.now() - 3_600_000)))),
          ),
        )
        .limit(1);
      if (repeat) throw new DuplicateSupplierPayment(`You already paid ${supplier.name} ${formatUsd(amountCents)} for "${description}" today.`);
    }

    const [row] = await tx
      .insert(supplierPayments)
      .values({ needId: need.id, charityId: charity.id, supplierId: supplier.id, amountCents, description, createdBy: ctx.userId })
      .returning({ id: supplierPayments.id });
    return { id: row!.id, supplierMerchantId: supplier.merchantId, supplierName: supplier.name, needTitle: need.title };
  });

  try {
    const order = await createSupplierPaymentOrder({
      paymentId: payment.id,
      amountCents: cents(amountCents),
      supplierMerchantId: payment.supplierMerchantId,
      description: `${description} - ${payment.needTitle}`,
      returnUrl: `${appUrl()}/pay-supplier/return?p=${payment.id}`,
      cancelUrl: `${appUrl()}/pay-supplier/cancel?p=${payment.id}`,
    });
    await db.update(supplierPayments).set({ paypalOrderId: order.orderId }).where(eq(supplierPayments.id, payment.id));
    return { approveUrl: order.approveUrl };
  } catch (e) {
    await db.update(supplierPayments).set({ status: "failed", failure: "PayPal didn't create the payment" }).where(eq(supplierPayments.id, payment.id));
    console.error("Supplier payment order failed", {
      paymentId: payment.id,
      status: e instanceof PayPalError ? e.status : undefined,
      issues: e instanceof PayPalError ? e.issues : undefined,
      error: e instanceof PayPalError ? undefined : e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
    throw new SupplierError("PayPal couldn't start this payment. Nothing was paid - try again.");
  }
}

type Settled = { status: "completed" | "not_approved" | "failed" | "processing"; message: string; needId: string | null };
type PaymentRow = {
  id: string;
  needId: string;
  charityId: string;
  status: string;
  orderId: string | null;
  amountCents: number;
  createdBy: string;
  captureRequestedAt: Date | null;
  supplierName: string;
  supplierMerchantId: string | null;
  supplierVerifiedAt: Date | null;
  supplierStatus: string;
};

const PAYMENT_ROW = {
  id: supplierPayments.id,
  needId: supplierPayments.needId,
  charityId: supplierPayments.charityId,
  status: supplierPayments.status,
  orderId: supplierPayments.paypalOrderId,
  amountCents: supplierPayments.amountCents,
  createdBy: supplierPayments.createdBy,
  captureRequestedAt: supplierPayments.captureRequestedAt,
  supplierName: suppliers.name,
  supplierMerchantId: suppliers.paypalMerchantId,
  supplierVerifiedAt: suppliers.verifiedAt,
  supplierStatus: suppliers.status,
};

const PROCESSING = "PayPal is still finishing this payment. Check back in a minute.";
const REJECTED_REASON = "A Proven reviewer couldn't confirm this supplier is a real, independent business.";

/**
 * After the charity approves on PayPal: check the payment is really from this
 * charity's own PayPal account to this supplier for this amount, then take it.
 * A completed payment becomes a passed "Paid the supplier with PayPal" proof.
 */
export async function completeSupplierPayment(ctx: CharityContext, paymentId: string): Promise<Settled> {
  if (!UUID.test(paymentId)) return { status: "failed", message: "Payment not found.", needId: null };
  const charity = await charityFor(ctx);
  const [p] = await getDb()
    .select(PAYMENT_ROW)
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.charityId, charity.id)))
    .limit(1);
  if (!p || !p.orderId) return { status: "failed", message: "Payment not found.", needId: null };
  return settlePayment(p, charity.merchantId, true);
}

/**
 * Brings one payment in line with PayPal's record. Money is only taken when
 * `mayCapture`; a capture PayPal already made is always recorded, whatever happens here.
 */
async function settlePayment(p: PaymentRow, charityMerchantId: string, mayCapture: boolean): Promise<Settled> {
  const db = getDb();
  const paidMsg = `Paid ${p.supplierName} ${formatUsd(p.amountCents)} with PayPal.`;
  if (p.status === "completed") return { status: "completed", message: paidMsg, needId: p.needId };
  if (p.status !== "created" || !p.orderId) return { status: "failed", message: "This payment was cancelled or didn't go through.", needId: p.needId };

  const fail = async (failure: string, moved = false) => {
    await db
      .update(supplierPayments)
      .set({ status: moved ? "refunded" : "failed", failure })
      .where(and(eq(supplierPayments.id, p.id), eq(supplierPayments.status, "created")));
    return { status: "failed" as const, message: moved ? failure : `${failure} Nothing was paid.`, needId: p.needId };
  };

  let order = await getSupplierPaymentOrder(p.orderId);
  // The money must come from the charity's own PayPal account, to this supplier, for this amount.
  const mismatch = () => {
    if (order.payerId !== charityMerchantId) return "It was approved from a PayPal account that isn't your charity's.";
    if (order.payeeMerchantId !== p.supplierMerchantId || order.referenceId !== p.id) return "The payment details didn't match.";
    if (!order.amountValue || toCents(order.amountValue) !== p.amountCents) return "The payment amount didn't match.";
    return null;
  };

  if (!order.capture) {
    if (order.status !== "APPROVED") return { status: "not_approved", message: "The payment wasn't approved on PayPal, so nothing was paid.", needId: p.needId };
    const wrong = mismatch();
    if (wrong) return fail(wrong);
    if (!mayCapture) return { status: "processing", message: PROCESSING, needId: p.needId };

    // Reserve the amount under the need lock, then call PayPal without holding it.
    // From here the payment counts toward the cap until it settles, so two
    // completions at once can't both fit under the need's cost.
    if (!p.captureRequestedAt) {
      const blocked = await db.transaction(async (tx) => {
        const [need] = await tx
          .select({ status: needs.status, amountCents: needs.amountCents })
          .from(needs)
          .where(and(eq(needs.id, p.needId), eq(needs.charityId, p.charityId)))
          .for("update");
        if (!need || !PAYABLE_NEED.includes(need.status)) return "This need is closed.";
        const [{ used = 0 } = {}] = await tx
          .select({ used: sql<number>`coalesce(sum(${supplierPayments.amountCents}), 0)::int` })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.needId, p.needId), ne(supplierPayments.id, p.id), COMMITTED));
        if (used + p.amountCents > need.amountCents) return `Payments for this need can't go over its ${formatUsd(need.amountCents)} cost.`;
        // If another visit reserved it a moment ago this changes nothing: the capture
        // request ID below makes both visits one capture.
        await tx
          .update(supplierPayments)
          .set({ captureRequestedAt: new Date() })
          .where(and(eq(supplierPayments.id, p.id), eq(supplierPayments.status, "created"), isNull(supplierPayments.captureRequestedAt)));
        return null;
      });
      if (blocked) return fail(blocked);
    }

    try {
      const r = await captureSupplierPaymentOrder(p.orderId, `${p.id}-capture`);
      order = { ...order, capture: r.capture };
    } catch (e) {
      if (!(e instanceof PayPalError) || e.status >= 500) return { status: "processing", message: PROCESSING, needId: p.needId };
      // Refused - but read PayPal's record before saying nothing was paid.
      console.error("Supplier payment was refused", { paymentId: p.id, status: e.status, issues: e.issues });
      order = await getSupplierPaymentOrder(p.orderId).catch(() => order);
      if (!order.capture) return fail("PayPal didn't complete the payment.");
    }
  } else {
    // PayPal already took this money (an earlier visit, or the daily check): record what happened.
    const wrong = mismatch();
    if (wrong) {
      console.error("Captured supplier payment doesn't match our record - needs a person", { paymentId: p.id });
      return { status: "processing", message: PROCESSING, needId: p.needId };
    }
  }

  const capture = order.capture;
  if (!capture || capture.status === "PENDING") return { status: "processing", message: PROCESSING, needId: p.needId };
  if (capture.status === "REFUNDED" || capture.status === "PARTIALLY_REFUNDED") return fail("PayPal shows this payment was refunded.", true);
  if (capture.status !== "COMPLETED") return fail("PayPal declined the payment.");

  const captureId = capture.id;
  await db.transaction(async (tx) => {
    const [upd] = await tx
      .update(supplierPayments)
      .set({ status: "completed", paypalCaptureId: captureId, completedAt: new Date() })
      .where(and(eq(supplierPayments.id, p.id), eq(supplierPayments.status, "created")))
      .returning({ id: supplierPayments.id });
    if (!upd) return;
    // Re-read inside the transaction: a reviewer may have just verified or rejected the supplier.
    const [sup] = await tx
      .select({ verifiedAt: suppliers.verifiedAt, status: suppliers.status })
      .from(suppliers)
      .innerJoin(supplierPayments, eq(supplierPayments.supplierId, suppliers.id))
      .where(eq(supplierPayments.id, p.id));
    const trusted = sup?.status === "connected" && sup.verifiedAt !== null;
    const [proof] = await tx
      .insert(proofs)
      .values({
        needId: p.needId,
        charityId: p.charityId,
        kind: "supplier_paypal_payment",
        status: sup?.status === "rejected" ? "failed" : trusted ? "passed" : "needs_review",
        reasons: [
          `Paid ${p.supplierName} ${formatUsd(p.amountCents)} with PayPal - PayPal confirmed the payment.`,
          ...(sup?.status === "rejected"
            ? [REJECTED_REASON]
            : trusted
              ? []
              : ["This supplier is not verified yet. A Proven reviewer checks the business once. Then its payments pass without review."]),
        ],
        amountCents: p.amountCents,
        submittedBy: p.createdBy,
      })
      .returning({ id: proofs.id });
    await tx.update(supplierPayments).set({ proofId: proof!.id }).where(eq(supplierPayments.id, p.id));
  });
  // Ask the (verified) supplier to confirm the handover. Best effort: the daily sweep retries.
  await requestSupplierConfirmation(p.id).catch((e) => console.error("Could not request supplier confirmation", { paymentId: p.id, error: e?.constructor?.name }));
  return { status: "completed", message: paidMsg, needId: p.needId };
}

/**
 * The charity backed out on PayPal. Only cancelled when PayPal agrees nothing
 * was approved or taken - the cancel link can be opened at any time.
 */
export async function cancelSupplierPayment(ctx: CharityContext, paymentId: string): Promise<string | null> {
  if (!UUID.test(paymentId)) return null;
  const db = getDb();
  const [p] = await db
    .select({ id: supplierPayments.id, needId: supplierPayments.needId, orderId: supplierPayments.paypalOrderId, captureRequestedAt: supplierPayments.captureRequestedAt })
    .from(supplierPayments)
    .where(and(eq(supplierPayments.id, paymentId), eq(supplierPayments.charityId, ctx.charityId), eq(supplierPayments.status, "created")))
    .limit(1);
  if (!p) return null;
  if (p.captureRequestedAt) return p.needId;
  if (p.orderId) {
    const order = await getSupplierPaymentOrder(p.orderId).catch(() => null);
    if (!order || order.capture || order.status === "APPROVED" || order.status === "COMPLETED") return p.needId;
  }
  await db
    .update(supplierPayments)
    .set({ status: "cancelled" })
    .where(and(eq(supplierPayments.id, p.id), eq(supplierPayments.status, "created"), isNull(supplierPayments.captureRequestedAt)));
  return p.needId;
}

export type SupplierPaymentView = {
  id: string;
  supplierName: string;
  amountCents: number;
  description: string;
  status: string;
  failure: string | null;
  disputedAt: Date | null;
  createdAt: Date;
};

/** A need's supplier payments, for its own charity. */
export async function listSupplierPayments(ctx: CharityContext, needId: string): Promise<SupplierPaymentView[]> {
  if (!UUID.test(needId)) return [];
  return getDb()
    .select({
      id: supplierPayments.id,
      supplierName: suppliers.name,
      amountCents: supplierPayments.amountCents,
      description: supplierPayments.description,
      status: supplierPayments.status,
      failure: supplierPayments.failure,
      disputedAt: supplierPayments.disputedAt,
      createdAt: supplierPayments.createdAt,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(and(eq(supplierPayments.needId, needId), eq(supplierPayments.charityId, ctx.charityId), inArray(supplierPayments.status, ["created", "completed", "failed", "refunded"])))
    .orderBy(desc(supplierPayments.createdAt));
}

/**
 * The supplier sent the money back, or PayPal reversed the payment. The proof
 * no longer stands on its own: it goes to a person. Safe to repeat.
 */
export async function markSupplierPaymentUndone(paypalCaptureId: string, why: "refunded" | "reversed"): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await lockNeedOfCapture(tx, paypalCaptureId);
    const [p] = await tx
      .update(supplierPayments)
      .set({ status: "refunded", failure: why === "refunded" ? "The supplier refunded this payment." : "PayPal reversed this payment." })
      .where(and(eq(supplierPayments.paypalCaptureId, paypalCaptureId), eq(supplierPayments.status, "completed")))
      .returning({ proofId: supplierPayments.proofId });
    if (!p) return false;
    if (p.proofId) {
      await tx
        .update(proofs)
        .set({
          status: "needs_review",
          reasons: sql`array_append(${proofs.reasons}, ${why === "refunded" ? "PayPal reports the supplier refunded this payment - a person checks it." : "PayPal reversed this payment - a person checks it."})`,
        })
        .where(eq(proofs.id, p.proofId));
    }
    return true;
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Takes the need's lock (shared) before a supplier payment's proof is withdrawn,
 * in the same order releases take it, so a withdrawal can't land between a
 * release's proof check and its capture.
 */
async function lockNeedOfCapture(tx: Tx, paypalCaptureId: string) {
  const [p] = await tx.select({ needId: supplierPayments.needId }).from(supplierPayments).where(eq(supplierPayments.paypalCaptureId, paypalCaptureId)).limit(1);
  if (p) await tx.select({ id: needs.id }).from(needs).where(eq(needs.id, p.needId)).for("share");
}

/** Is this PayPal capture one of the supplier payments made through Proven? */
export async function isSupplierCapture(paypalCaptureId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: supplierPayments.id }).from(supplierPayments).where(eq(supplierPayments.paypalCaptureId, paypalCaptureId)).limit(1);
  return Boolean(row);
}

/**
 * Daily, against PayPal's records:
 * - finishes payments whose capture was requested but never confirmed (money may have moved);
 * - cancels payments never approved after a day;
 * - re-checks completed payments for 180 days (a supplier can refund, a buyer can
 *   dispute), least recently checked first, in case a webhook never arrived.
 */
export async function sweepSupplierPayments(limit = 50): Promise<{ settled: number; cancelled: number; undone: number; detailsFilled: number; confirmationsAsked: number }> {
  const db = getDb();
  const out = { settled: 0, cancelled: 0, undone: 0, detailsFilled: await fillSupplierDetails(), confirmationsAsked: await requestMissingConfirmations().catch(() => 0) };

  const open = await db
    .select({ ...PAYMENT_ROW, createdAt: supplierPayments.createdAt, charityMerchantId: charities.paypalMerchantId, charityStatus: charities.status })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .innerJoin(charities, eq(charities.id, supplierPayments.charityId))
    .where(and(eq(supplierPayments.status, "created"), isNotNull(supplierPayments.paypalOrderId), lt(supplierPayments.createdAt, new Date(Date.now() - 10 * 60_000))))
    .orderBy(supplierPayments.createdAt)
    .limit(limit);
  for (const p of open) {
    if (!p.charityMerchantId) continue;
    try {
      if (p.captureRequestedAt) {
        // A capture was asked for: retrying with the same request ID never takes the money twice.
        const r = await settlePayment(p, p.charityMerchantId, p.charityStatus === "active");
        if (r.status === "completed" || r.status === "failed") out.settled++;
      } else if (p.createdAt < new Date(Date.now() - 86_400_000)) {
        const order = await getSupplierPaymentOrder(p.orderId!);
        if (order.capture) {
          const r = await settlePayment(p, p.charityMerchantId, false);
          if (r.status === "completed" || r.status === "failed") out.settled++;
        } else if (order.status !== "APPROVED" && order.status !== "COMPLETED") {
          await db
            .update(supplierPayments)
            .set({ status: "cancelled", failure: "Not approved in PayPal." })
            .where(and(eq(supplierPayments.id, p.id), eq(supplierPayments.status, "created"), isNull(supplierPayments.captureRequestedAt)));
          out.cancelled++;
        }
      }
    } catch {
      // Checked again tomorrow.
    }
  }

  const done = await db
    .select({ id: supplierPayments.id, captureId: supplierPayments.paypalCaptureId })
    .from(supplierPayments)
    .where(and(eq(supplierPayments.status, "completed"), gt(supplierPayments.completedAt, new Date(Date.now() - 180 * 86_400_000))))
    .orderBy(sql`${supplierPayments.lastCheckedAt} asc nulls first`)
    .limit(limit);
  for (const r of done) {
    if (!r.captureId) continue;
    try {
      const status = await supplierCaptureStatus(r.captureId);
      if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") out.undone += Number(await markSupplierPaymentUndone(r.captureId, "refunded"));
      else if (status !== "COMPLETED" && status !== "PENDING") out.undone += Number(await markSupplierPaymentUndone(r.captureId, "reversed"));
      await db.update(supplierPayments).set({ lastCheckedAt: new Date() }).where(eq(supplierPayments.id, r.id));
    } catch {
      // Checked again tomorrow.
    }
  }
  return out;
}

/**
 * The charity opened a PayPal dispute on a supplier payment: it may get the money
 * back, so the proof goes to a person. Safe to repeat.
 */
export async function markSupplierPaymentDisputed(paypalCaptureId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await lockNeedOfCapture(tx, paypalCaptureId);
    const [p] = await tx
      .update(supplierPayments)
      .set({ disputedAt: new Date() })
      .where(and(eq(supplierPayments.paypalCaptureId, paypalCaptureId), isNull(supplierPayments.disputedAt)))
      .returning({ proofId: supplierPayments.proofId });
    if (!p) return false;
    if (p.proofId) {
      await tx
        .update(proofs)
        .set({ status: "needs_review", reasons: sql`array_append(${proofs.reasons}, ${"The charity opened a PayPal dispute on this payment - a person checks it."})` })
        .where(and(eq(proofs.id, p.proofId), ne(proofs.status, "failed")));
    }
    return true;
  });
}

export type SupplierToVerify = {
  id: string;
  name: string;
  email: string;
  paypalName: string | null;
  country: string | null;
  invitedBy: string | null;
  connectedAt: Date | null;
  paidCents: number;
};

/** Connected suppliers nobody has verified yet. A demo reviewer sees only demo suppliers. */
export async function listSuppliersToVerify(reviewer: ReviewerContext): Promise<SupplierToVerify[]> {
  const rows = await getDb()
    .select({
      id: suppliers.id,
      name: suppliers.name,
      email: suppliers.paypalEmail,
      paypalName: suppliers.paypalLegalName,
      country: suppliers.paypalCountry,
      invitedBy: charities.name,
      connectedAt: suppliers.connectedAt,
      paidCents: sql<number>`coalesce((select sum(${supplierPayments.amountCents}) from ${supplierPayments} where ${supplierPayments.supplierId} = ${suppliers.id} and ${supplierPayments.status} = 'completed'), 0)::int`,
    })
    .from(suppliers)
    .leftJoin(charities, eq(charities.id, suppliers.invitedByCharityId))
    .where(and(eq(suppliers.status, "connected"), isNull(suppliers.verifiedAt), reviewer.isDemo ? eq(suppliers.isDemo, true) : undefined))
    .orderBy(suppliers.connectedAt);
  return rows;
}

/**
 * A reviewer found the business on their own (website, public listing) and it is
 * a real supplier, not the charity. Its payments waiting for this now pass.
 */
export async function verifySupplier(reviewer: ReviewerContext, supplierId: string): Promise<void> {
  if (!UUID.test(supplierId)) throw new SupplierError("Supplier not found.");
  await verifyInTx(reviewer, supplierId);
  // Now it's trusted, ask it to confirm payments made while it wasn't.
  await requestMissingConfirmations(supplierId).catch(() => 0);
}

async function verifyInTx(reviewer: ReviewerContext, supplierId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [s] = await tx
      .update(suppliers)
      .set({ verifiedAt: new Date(), reviewedBy: reviewer.userId })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.status, "connected"), isNull(suppliers.verifiedAt), reviewer.isDemo ? eq(suppliers.isDemo, true) : undefined))
      .returning({ id: suppliers.id });
    if (!s) throw new SupplierError("This supplier was already reviewed, or isn't yours to review.");
    // Only proofs that waited on verification: payment still completed and not disputed.
    await tx
      .update(proofs)
      .set({ status: "passed", reasons: sql`array_append(${proofs.reasons}, ${"Supplier verified by a Proven reviewer."})` })
      .where(
        and(
          eq(proofs.status, "needs_review"),
          inArray(
            proofs.id,
            tx
              .select({ id: supplierPayments.proofId })
              .from(supplierPayments)
              .where(and(eq(supplierPayments.supplierId, s.id), eq(supplierPayments.status, "completed"), isNull(supplierPayments.disputedAt), isNotNull(supplierPayments.proofId))),
          ),
        ),
      );
  });
}

/** Not a real, independent business: it can't be paid, and payments to it don't count as proof. */
export async function rejectSupplier(reviewer: ReviewerContext, supplierId: string): Promise<void> {
  if (!UUID.test(supplierId)) throw new SupplierError("Supplier not found.");
  await getDb().transaction(async (tx) => {
    const [s] = await tx
      .update(suppliers)
      .set({ status: "rejected", reviewedBy: reviewer.userId })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.status, "connected"), isNull(suppliers.verifiedAt), reviewer.isDemo ? eq(suppliers.isDemo, true) : undefined))
      .returning({ id: suppliers.id });
    if (!s) throw new SupplierError("This supplier was already reviewed, or isn't yours to review.");
    await tx
      .update(proofs)
      .set({ status: "failed", reasons: sql`array_append(${proofs.reasons}, ${REJECTED_REASON})` })
      .where(inArray(proofs.id, tx.select({ id: supplierPayments.proofId }).from(supplierPayments).where(and(eq(supplierPayments.supplierId, s.id), isNotNull(supplierPayments.proofId)))));
  });
}

/**
 * A verified supplier later found not to be independent (it colludes with a
 * charity, or isn't a real business). It can't be paid any more, and every proof
 * resting on it fails: its PayPal payments and its own confirmations. Needs already
 * released on it then show in "Proof withdrawn after release".
 */
export async function revokeSupplier(reviewer: ReviewerContext, supplierId: string): Promise<void> {
  if (!UUID.test(supplierId)) throw new SupplierError("Supplier not found.");
  await getDb().transaction(async (tx) => {
    // Lock every affected need (shared, in a fixed order) as releases do, so no release
    // can pass its proof check while this lands.
    const affected = await tx
      .selectDistinct({ needId: supplierPayments.needId })
      .from(supplierPayments)
      .where(eq(supplierPayments.supplierId, supplierId))
      .orderBy(supplierPayments.needId);
    for (const a of affected) await tx.select({ id: needs.id }).from(needs).where(eq(needs.id, a.needId)).for("share");
    const [s] = await tx
      .update(suppliers)
      .set({ status: "rejected", reviewedBy: reviewer.userId })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.status, "connected"), isNotNull(suppliers.verifiedAt), reviewer.isDemo ? eq(suppliers.isDemo, true) : undefined))
      .returning({ id: suppliers.id });
    if (!s) throw new SupplierError("This supplier isn't verified, or isn't yours to review.");
    const resting = sql`${proofs.id} in (
      select ${supplierPayments.proofId} from ${supplierPayments} where ${supplierPayments.supplierId} = ${s.id} and ${supplierPayments.proofId} is not null
      union
      select ${supplierConfirmations.proofId} from ${supplierConfirmations} where ${supplierConfirmations.supplierId} = ${s.id} and ${supplierConfirmations.proofId} is not null)`;
    await tx
      .update(proofs)
      .set({ status: "failed", reasons: sql`array_append(${proofs.reasons}, ${"A Proven reviewer withdrew this supplier's verification - it no longer counts as proof."})` })
      .where(and(resting, ne(proofs.status, "failed")));
  });
}

export type VerifiedSupplier = { id: string; name: string; paypalName: string | null; country: string | null; verifiedAt: Date; paidCents: number };

/** Verified suppliers a reviewer may act on, most-paid first. */
export async function listVerifiedSuppliers(reviewer: ReviewerContext): Promise<VerifiedSupplier[]> {
  const paid = sql<number>`coalesce(sum(${supplierPayments.amountCents}) filter (where ${supplierPayments.status} = 'completed'), 0)::int`;
  const rows = await getDb()
    .select({ id: suppliers.id, name: suppliers.name, paypalName: suppliers.paypalLegalName, country: suppliers.paypalCountry, verifiedAt: suppliers.verifiedAt, paidCents: paid })
    .from(suppliers)
    .leftJoin(supplierPayments, eq(supplierPayments.supplierId, suppliers.id))
    .where(and(eq(suppliers.status, "connected"), isNotNull(suppliers.verifiedAt), reviewer.isDemo ? eq(suppliers.isDemo, true) : undefined))
    .groupBy(suppliers.id)
    .orderBy(desc(paid))
    .limit(100);
  return rows.map((r) => ({ ...r, verifiedAt: r.verifiedAt! }));
}

/** Fills in PayPal's own name and country for connected suppliers that don't have them yet. */
export async function fillSupplierDetails(limit = 20): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: suppliers.id, trackingId: suppliers.paypalTrackingId, merchantId: suppliers.paypalMerchantId })
    .from(suppliers)
    .where(and(eq(suppliers.status, "connected"), isNull(suppliers.paypalLegalName)))
    .limit(limit);
  let filled = 0;
  for (const r of rows) {
    try {
      const m = await connectedMerchant(r.trackingId);
      if (!m || m.merchantId !== r.merchantId || !m.legalName) continue;
      await db.update(suppliers).set({ paypalLegalName: m.legalName, paypalCountry: m.country }).where(eq(suppliers.id, r.id));
      filled++;
    } catch {
      // Tried again tomorrow.
    }
  }
  return filled;
}

export type WithdrawnProof = { needId: string; needTitle: string; charityName: string; releasedCents: number; supplierPaidCents: number };

/**
 * Needs where donors were charged more than the supplier payments that still
 * stand: a supplier refunded, the charity disputed, or a supplier was rejected
 * after the release. A person follows up (refund donors, lower the charity's trust).
 */
export async function listWithdrawnProofNeeds(reviewer: ReviewerContext): Promise<WithdrawnProof[]> {
  const scope = await reviewerCharityScope(reviewer);
  if (scope !== null && scope.length === 0) return [];
  // Net of refunds: once a reviewer refunds donors, the need drops off this list.
  const released = sql<number>`(select coalesce(sum(${donations.capturedCents} - ${donations.refundedCents}), 0) from ${donations} where ${donations.needId} = ${needs.id})::int`;
  // The same chain the release rule counts: completed, undisputed, verified supplier, passed proof.
  const paid = sql<number>`(select coalesce(sum(sp.amount_cents), 0) from ${supplierPayments} sp
    join ${suppliers} s on s.id = sp.supplier_id join ${proofs} pr on pr.id = sp.proof_id
    where sp.need_id = ${needs.id} and sp.status = 'completed' and sp.disputed_at is null
      and s.status = 'connected' and s.verified_at is not null and pr.status = 'passed')::int`;
  // Only needs whose final release went through: an open need with just a booking payment isn't an alert.
  const finalDone = sql`exists (select 1 from ${releases} r where r.need_id = ${needs.id} and r.kind = 'final' and r.status = 'completed')`;
  return getDb()
    .select({ needId: needs.id, needTitle: needs.title, charityName: charities.name, releasedCents: released, supplierPaidCents: paid })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(
      and(
        sql`'supplier_paypal_payment' = any(${needs.requiredProof})`,
        finalDone,
        sql`${released} > ${paid}`,
        scope === null ? undefined : inArray(needs.charityId, scope),
      ),
    )
    .orderBy(desc(needs.updatedAt))
    .limit(50);
}
