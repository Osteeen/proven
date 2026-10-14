import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { donations, ledgerEntries } from "@/server/db/schema";
import { cents } from "@/server/money";
import { PayPalError } from "@/server/paypal/client";
import { reauthorizeAuthorization } from "@/server/paypal/orders";

export const HONOR_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
/** Renew a hold at most once until a sandbox test shows a second renewal is allowed. */
const MAX_RENEWALS = 1;

/**
 * The authorization a capture should use. PayPal guarantees a hold's funds for
 * 3 days (the honor period); after that, the amount still held is renewed
 * first (reauthorized), once per hold, so the capture is backed by fresh
 * guaranteed funds. Facts from sandbox (tests 5 and 15, Cosign Oct 14):
 * - the renewal gets a NEW ID; the 29-day expiry does not move;
 * - on a partly charged hold, only the remaining amount can be renewed;
 * - both IDs can capture and they share ONE hold (no second hold on the donor);
 * - the invoice_id duplicate guard holds across both IDs;
 * - voids must go to the ORIGINAL ID.
 * Renewing is best effort: if PayPal refuses, the capture is still tried on the
 * existing ID - captures after day 3 work, they just lose the guarantee.
 */
export async function authorizationForCapture(donationId: string, now = new Date()): Promise<string | null> {
  const db = getDb();
  const [d] = await db
    .select({
      id: donations.id,
      charityId: donations.charityId,
      amountCents: donations.amountCents,
      capturedCents: donations.capturedCents,
      original: donations.paypalAuthorizationId,
      current: donations.captureAuthorizationId,
      honorEnds: donations.honorPeriodEndsAt,
      count: donations.reauthorizeCount,
      attemptId: donations.renewalRequestId,
      attemptAmount: donations.renewalAmountCents,
    })
    .from(donations)
    .where(eq(donations.id, donationId))
    .limit(1);
  if (!d?.original) return null;
  const current = d.current ?? d.original;

  // Already renewed, or still inside the honor period: nothing to do.
  if (d.count >= MAX_RENEWALS || !d.honorEnds || now < d.honorEnds) return current;

  // The one renewal for this hold is saved before PayPal is called and reused on
  // every retry: same request ID, same amount. A lost reply can't renew twice.
  let attempt = d.attemptId && d.attemptAmount ? { id: d.attemptId, amount: d.attemptAmount } : null;
  if (!attempt) {
    const remaining = d.amountCents - d.capturedCents;
    if (remaining <= 0) return current;
    const [saved] = await db
      .update(donations)
      .set({ renewalRequestId: `${d.id}-renew-${randomUUID()}`, renewalAmountCents: remaining })
      .where(and(eq(donations.id, d.id), isNull(donations.renewalRequestId)))
      .returning({ id: donations.renewalRequestId, amount: donations.renewalAmountCents });
    if (saved?.id && saved.amount) attempt = { id: saved.id, amount: saved.amount };
    else {
      // Another run saved one first: use theirs.
      const [theirs] = await db
        .select({ id: donations.renewalRequestId, amount: donations.renewalAmountCents })
        .from(donations)
        .where(eq(donations.id, d.id));
      if (!theirs?.id || !theirs.amount) return current;
      attempt = { id: theirs.id, amount: theirs.amount };
    }
  }

  let renewed: string;
  try {
    const r = await reauthorizeAuthorization(d.original, cents(attempt.amount), attempt.id);
    renewed = r.authorizationId;
    const honorEnds = new Date(r.createTime.getTime() + HONOR_PERIOD_MS);
    await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(donations)
        .set({ captureAuthorizationId: renewed, honorPeriodEndsAt: honorEnds, reauthorizeCount: d.count + 1 })
        .where(and(eq(donations.id, d.id), eq(donations.reauthorizeCount, d.count)))
        .returning({ id: donations.id });
      if (!upd) return; // Another run recorded this same renewal first.
      await tx.insert(ledgerEntries).values({
        charityId: d.charityId,
        donationId: d.id,
        event: "reauthorized",
        amountCents: attempt.amount,
        paypalReference: renewed,
        actorType: "system",
        details: { original: d.original, previous: current, moneyMoved: false },
      });
    });
  } catch (e) {
    if (e instanceof PayPalError) {
      console.error("PayPal refused to renew a hold - capturing on the existing authorization", {
        donationId: d.id,
        status: e.status,
        issues: e.issues,
      });
    } else {
      console.error("Renewing a hold failed (network or database) - capturing on the existing authorization", {
        donationId: d.id,
        error: e instanceof Error ? e.message : e,
      });
    }
    return current;
  }
  // Whoever recorded it, the stored ID is the one to use.
  const [stored] = await db.select({ current: donations.captureAuthorizationId }).from(donations).where(eq(donations.id, d.id));
  return stored?.current ?? renewed;
}
