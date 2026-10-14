import "server-only";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { captures, donations, ledgerEntries } from "@/server/db/schema";
import { getOrderPayments } from "@/server/paypal/orders";
import { paypalRequest } from "@/server/paypal/client";
import { toCents } from "@/server/money";
import { recordCaptureSuccess } from "@/server/releases/service";

const MONEY_TAKEN = ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED", "PENDING"];

/**
 * Holds past their 29-day expiry that our records still show as held. Before a
 * hold is closed as "never charged", PayPal's own record decides twice over:
 * the authorization must be EXPIRED or VOIDED, and PayPal's captures on the
 * order must match ours. Any unrecorded capture (a lost reply) is recorded
 * first; anything still unexplained is left for a person and logged.
 */
export async function markLapsedHolds(now = new Date()): Promise<{ checked: number; closed: number; needsLook: number }> {
  const db = getDb();
  const stale = await db
    .select({ id: donations.id, authId: donations.paypalAuthorizationId, orderId: donations.paypalOrderId })
    .from(donations)
    .where(and(inArray(donations.status, ["authorized", "partially_captured"]), lt(donations.holdExpiresAt, now)))
    .orderBy(asc(donations.holdExpiresAt))
    .limit(200);

  let closed = 0;
  let needsLook = 0;
  for (const s of stale) {
    if (!s.authId || !s.orderId) continue;
    try {
      const auth = await paypalRequest<{ status?: string }>("GET", `/v2/payments/authorizations/${encodeURIComponent(s.authId)}`);
      if (auth.status !== "EXPIRED" && auth.status !== "VOIDED") continue;

      // Our unfinished capture rows on this hold: PayPal may have taken the money.
      const open = await db
        .select({
          id: captures.id,
          donationId: captures.donationId,
          amountCents: captures.amountCents,
          final: captures.finalCapture,
          charityId: captures.charityId,
          releaseId: captures.releaseId,
          authorizationId: donations.paypalAuthorizationId,
        })
        .from(captures)
        .innerJoin(donations, eq(donations.id, captures.donationId))
        .where(and(eq(captures.donationId, s.id), inArray(captures.status, ["pending", "failed"])));
      const paypal = await getOrderPayments(s.orderId);
      for (const c of open) {
        const found = paypal.captures.find((p) => p.invoiceId === c.id && MONEY_TAKEN.includes(p.status) && p.status !== "PENDING");
        if (found) await recordCaptureSuccess(c, found.id, "system");
      }
      const paypalTaken = paypal.captures
        .filter((p) => MONEY_TAKEN.includes(p.status))
        .reduce((sum, p) => sum + (p.amountValue ? toCents(p.amountValue) : 0), 0);

      const outcome = await db.transaction(async (tx) => {
        const [d] = await tx
          .select({
            charityId: donations.charityId,
            amountCents: donations.amountCents,
            capturedCents: donations.capturedCents,
            status: donations.status,
            unfinished: sql<number>`(select count(*) from ${captures} where ${captures.donationId} = ${donations.id} and ${captures.status} in ('pending', 'failed'))::int`,
          })
          .from(donations)
          .where(eq(donations.id, s.id))
          .for("update", { of: donations });
        if (!d || (d.status !== "authorized" && d.status !== "partially_captured")) return "skip";
        // Anything we can't explain stays open for a person: never call it "never charged".
        if (d.unfinished > 0 || paypalTaken !== d.capturedCents) return "look";
        const left = d.amountCents - d.capturedCents;
        await tx.update(donations).set({ status: d.capturedCents > 0 ? "captured" : auth.status === "VOIDED" ? "voided" : "expired" }).where(eq(donations.id, s.id));
        await tx.insert(ledgerEntries).values({
          charityId: d.charityId,
          donationId: s.id,
          event: auth.status === "VOIDED" ? "voided" : "expired",
          amountCents: left,
          paypalReference: s.authId,
          actorType: "system",
          details: {
            paypalStatus: auth.status,
            reason: d.capturedCents > 0 ? "rest of the hold lapsed - never charged" : "hold lapsed - never charged",
          },
        });
        return "closed";
      });
      if (outcome === "closed") closed++;
      if (outcome === "look") {
        needsLook++;
        console.error("Lapsed hold needs a person: PayPal's captures and ours don't match", { donationId: s.id, paypalTaken });
      }
    } catch (e) {
      console.error("Lapsed-hold check skipped one", { donationId: s.id, error: e instanceof Error ? e.message : e });
    }
  }
  return { checked: stale.length, closed, needsLook };
}
