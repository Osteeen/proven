import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { captures, donations, ledgerEntries, refunds, webhookEvents } from "@/server/db/schema";
import { notifyDonorsOfRefunds, recordRefundSuccess } from "@/server/releases/refunds";
import { recordCaptureSuccess } from "@/server/releases/service";
import { toCents } from "@/server/money";
import { paypalRequest } from "./client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WebhookEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: { value?: string };
    invoice_id?: string;
    supplementary_data?: { related_ids?: { authorization_id?: string } };
  };
};

function safeCents(value: string | undefined): number | undefined {
  try {
    return value ? toCents(value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks PayPal whether this delivery really came from PayPal for our webhook.
 * Nothing in an unverified body is ever trusted.
 */
export async function verifyWebhook(headers: Headers, event: unknown, webhookId: string): Promise<boolean> {
  const h = (k: string) => headers.get(k) ?? "";
  if (!h("paypal-transmission-sig") || !h("paypal-cert-url")) return false;
  const res = await paypalRequest<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return res.verification_status === "SUCCESS";
}

/**
 * Applies a verified event once (PayPal retries deliveries). Our own writes are
 * normally ahead of PayPal's notifications; webhooks repair the rare case where
 * PayPal moved money but our write was lost, and flag anything surprising.
 */
export async function handleVerifiedEvent(event: WebhookEvent): Promise<string> {
  const db = getDb();
  await db
    .insert(webhookEvents)
    .values({ id: event.id, eventType: event.event_type, resourceId: event.resource?.id ?? null, verified: true })
    .onConflictDoNothing();
  // An event is done only once its outcome is written. A delivery that failed
  // halfway (outcome still empty) is processed again when PayPal retries; every
  // handler below is safe to repeat.
  const [seen] = await db.select({ outcome: webhookEvents.outcome }).from(webhookEvents).where(eq(webhookEvents.id, event.id)).limit(1);
  if (seen?.outcome) return "duplicate";

  let outcome = "ignored";
  const r = event.resource ?? {};
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && r.id) {
    const [known] = await db.select({ id: captures.id }).from(captures).where(eq(captures.paypalCaptureId, r.id)).limit(1);
    if (known) outcome = "already recorded";
    else {
      // We tag every capture with our own capture row ID as invoice_id.
      const rowId = r.invoice_id && UUID.test(r.invoice_id) ? r.invoice_id : undefined;
      const authId = r.supplementary_data?.related_ids?.authorization_id;
      const amount = safeCents(r.amount?.value);
      const [row] = rowId && authId && amount !== undefined
        ? await db
            .select({
              id: captures.id,
              donationId: captures.donationId,
              amountCents: captures.amountCents,
              final: captures.finalCapture,
              authorizationId: donations.paypalAuthorizationId,
              charityId: captures.charityId,
              releaseId: captures.releaseId,
            })
            .from(captures)
            .innerJoin(donations, eq(donations.id, captures.donationId))
            // Every detail must agree: our row, PayPal's authorization, and the amount.
            .where(and(eq(captures.id, rowId), eq(donations.paypalAuthorizationId, authId), eq(captures.amountCents, amount)))
            .limit(1)
        : [];
      outcome = row && (await recordCaptureSuccess(row, r.id, "paypal_webhook")) ? "repaired: capture recorded" : "unmatched capture - needs review";
    }
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" && r.id) {
    // The resource is the refund. We tag every refund with our refund row ID as invoice_id.
    const rowId = r.invoice_id && UUID.test(r.invoice_id) ? r.invoice_id : undefined;
    const amount = safeCents(r.amount?.value);
    const [row] = rowId && amount !== undefined && r.status === "COMPLETED"
      ? await db
          .select({ id: refunds.id, captureId: refunds.captureId, donationId: refunds.donationId, charityId: refunds.charityId, amountCents: refunds.amountCents })
          .from(refunds)
          .where(and(eq(refunds.id, rowId), eq(refunds.amountCents, amount)))
          .limit(1)
      : [];
    if (!row) outcome = "unmatched refund - needs review";
    else if (await recordRefundSuccess(row, r.id, "paypal_webhook")) {
      outcome = "repaired: refund recorded";
      await notifyDonorsOfRefunds();
    } else outcome = "already recorded";
  } else if ((event.event_type === "PAYMENT.CAPTURE.DENIED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") && r.id) {
    // Money we recorded as captured did not stay captured. Never reversed automatically - a person looks.
    outcome = "capture denied or reversed - needs review";
  } else if (event.event_type === "PAYMENT.AUTHORIZATION.VOIDED" && r.id) {
    const updated = await db.transaction(async (tx) => {
      // A hold with an advance already taken keeps that charge and settles as "captured".
      const rows = await tx
        .update(donations)
        .set({ status: sql`case when ${donations.capturedCents} > 0 then 'captured'::donation_status else 'voided'::donation_status end` })
        .where(and(eq(donations.paypalAuthorizationId, r.id!), inArray(donations.status, ["authorized", "partially_captured"])))
        .returning({ id: donations.id, charityId: donations.charityId, amountCents: donations.amountCents, capturedCents: donations.capturedCents });
      for (const d of rows) {
        await tx.insert(ledgerEntries).values({
          charityId: d.charityId,
          donationId: d.id,
          event: "voided",
          amountCents: d.amountCents - d.capturedCents,
          paypalReference: r.id,
          actorType: "paypal_webhook",
          details: { eventId: event.id },
        });
      }
      return rows.length;
    });
    outcome = updated ? "hold marked cancelled" : "already cancelled";
  }
  await db.update(webhookEvents).set({ outcome }).where(eq(webhookEvents.id, event.id));
  return outcome;
}
