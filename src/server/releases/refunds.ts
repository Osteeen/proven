import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { reviewerMayActOn, type ReviewerContext } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { captures, charities, donations, ledgerEntries, needs, refunds, releases } from "@/server/db/schema";
import { cents, formatUsd } from "@/server/money";
import { PayPalError } from "@/server/paypal/client";
import { getOrderPayments, refundCapture } from "@/server/paypal/orders";
import { emailDonorsAboutRefund } from "./emails";
import { ReleaseError } from "./service";
import { allocate } from "./rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED: string[] = ["proven", "not_proven", "cancelled"];
/** A pending refund younger than this may still be on its way to PayPal. */
export const RETRY_AFTER_MS = 10 * 60 * 1000;

type RefundRow = {
  id: string;
  captureId: string;
  donationId: string;
  charityId: string;
  amountCents: number;
  requestId: string;
  paypalCaptureId: string | null;
  orderId: string | null;
  merchantId: string | null;
};

/**
 * A reviewer gives charged money back to a need's donors - for example when a
 * delivery turns out to be false. The amount is split across the charges in
 * proportion, each refund is sent to PayPal on the charity's behalf, and every
 * step is recorded once. Only reviewers can refund; charities cannot pull
 * money back from donors or push it to themselves.
 */
export async function refundNeed(
  reviewer: ReviewerContext,
  needId: string,
  input: { amountCents: number; reason: string },
): Promise<{ batchId: string; status: "completed" | "unfinished" }> {
  if (!UUID.test(needId)) throw new ReleaseError("Need not found.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new ReleaseError("Enter an amount to refund.");
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 5) throw new ReleaseError("Say why the money goes back - donors and the charity see this.");
  const db = getDb();

  const batchId = await db.transaction(async (tx) => {
    const [need] = await tx.select({ id: needs.id, charityId: needs.charityId, status: needs.status }).from(needs).where(eq(needs.id, needId)).for("update");
    if (!need || !(await reviewerMayActOn(reviewer, need.charityId))) throw new ReleaseError("Need not found.");
    // Refunds settle a closed need, so donor emails and totals can't race a release or settlement.
    if (!CLOSED.includes(need.status)) throw new ReleaseError("Close this need first (mark it not proven), then refund.");
    const [running] = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.needId, need.id), inArray(releases.status, ["approved", "executing"])))
      .limit(1);
    if (running) throw new ReleaseError("A release is still running for this need. Try again in a moment.");

    const [unfinished] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.needId, need.id), eq(refunds.status, "pending")))
      .limit(1);
    // A pending refund may have reached PayPal; settle it before planning another.
    if (unfinished) throw new ReleaseError("An earlier refund for this need didn't finish. Retry it first.");

    const charged = await tx
      .select({ id: captures.id, donationId: captures.donationId, amountCents: captures.amountCents, refundedCents: captures.refundedCents })
      .from(captures)
      .innerJoin(donations, eq(donations.id, captures.donationId))
      .where(and(eq(donations.needId, need.id), eq(captures.status, "completed"), sql`${captures.refundedCents} < ${captures.amountCents}`))
      .for("update", { of: captures });
    const refundable = charged.reduce((s, c) => s + c.amountCents - c.refundedCents, 0);
    if (refundable === 0) throw new ReleaseError("Nothing on this need was charged, so there is nothing to refund.");
    if (input.amountCents > refundable) throw new ReleaseError(`Only ${formatUsd(refundable)} can be refunded.`);

    const id = randomUUID();
    const shares = allocate(
      input.amountCents,
      charged.map((c) => ({ donationId: c.id, availableCents: c.amountCents - c.refundedCents })),
    );
    for (const s of shares.filter((x) => x.cents > 0)) {
      const cap = charged.find((c) => c.id === s.donationId)!;
      await tx.insert(refunds).values({
        batchId: id,
        needId: need.id,
        captureId: cap.id,
        donationId: cap.donationId,
        charityId: need.charityId,
        amountCents: s.cents,
        requestId: randomUUID(),
        reason,
        requestedBy: reviewer.userId,
      });
    }
    return id;
  });

  // The plan is committed: from here an error must never read as "nothing was refunded".
  let done = false;
  try {
    done = await runRefundBatch(batchId, false);
  } catch (e) {
    console.error("Refund run stopped", { batchId, error: e instanceof Error ? e.message : e });
  }
  await notifyDonorsOfRefunds();
  return { batchId, status: done ? "completed" : "unfinished" };
}

/** A reviewer retries a refund that didn't finish. PayPal's record is checked first, so nothing is refunded twice. */
export async function retryRefund(reviewer: ReviewerContext, batchId: string): Promise<"completed" | "unfinished"> {
  if (!UUID.test(batchId)) throw new ReleaseError("Refund not found.");
  const db = getDb();
  const [row] = await db.select({ charityId: refunds.charityId }).from(refunds).where(eq(refunds.batchId, batchId)).limit(1);
  if (!row || !(await reviewerMayActOn(reviewer, row.charityId))) throw new ReleaseError("Refund not found.");
  // A refund that may still be on its way to PayPal is left alone, so two sends never overlap.
  const [fresh] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.batchId, batchId), eq(refunds.status, "pending"), gt(refunds.updatedAt, new Date(Date.now() - RETRY_AFTER_MS))))
    .limit(1);
  if (fresh) throw new ReleaseError("This refund was sent a moment ago. Give PayPal a few minutes, then retry.");
  let done = false;
  try {
    done = await runRefundBatch(batchId, true);
  } finally {
    await notifyDonorsOfRefunds();
  }
  return done ? "completed" : "unfinished";
}

async function runRefundBatch(batchId: string, isRetry: boolean): Promise<boolean> {
  if (isRetry) await recheckRefused(batchId);
  const rows: RefundRow[] = await getDb()
    .select({
      id: refunds.id,
      captureId: refunds.captureId,
      donationId: refunds.donationId,
      charityId: refunds.charityId,
      amountCents: refunds.amountCents,
      requestId: refunds.requestId,
      paypalCaptureId: captures.paypalCaptureId,
      orderId: donations.paypalOrderId,
      merchantId: charities.paypalMerchantId,
    })
    .from(refunds)
    .innerJoin(captures, eq(captures.id, refunds.captureId))
    .innerJoin(donations, eq(donations.id, refunds.donationId))
    .innerJoin(charities, eq(charities.id, refunds.charityId))
    // Only uncertain (pending) rows run again; PayPal's definite refusals stay refused.
    .where(and(eq(refunds.batchId, batchId), eq(refunds.status, "pending")));
  let all = true;
  for (const r of rows) if (!(await refundOnce(r, isRetry))) all = false;
  return all;
}

/** A refund marked refused is checked against PayPal's record once more (it may have gone through); never re-sent. */
async function recheckRefused(batchId: string) {
  const refused = await getDb()
    .select({ id: refunds.id, captureId: refunds.captureId, donationId: refunds.donationId, charityId: refunds.charityId, amountCents: refunds.amountCents, orderId: donations.paypalOrderId })
    .from(refunds)
    .innerJoin(donations, eq(donations.id, refunds.donationId))
    .where(and(eq(refunds.batchId, batchId), eq(refunds.status, "failed")));
  for (const r of refused) {
    try {
      const view = await refundOnPayPal(r.orderId, r.id);
      if (view.state === "completed") await recordRefundSuccess(r, view.paypalRefundId, "system");
    } catch (e) {
      console.error("Couldn't recheck refund", { refundId: r.id, error: e instanceof Error ? e.message : e });
    }
  }
}

/**
 * Emails donors about refunds that completed and haven't been emailed yet -
 * whoever completed them (this flow, a retry or the webhook). The claim is a
 * conditional update, so each refund is emailed exactly once.
 */
export async function notifyDonorsOfRefunds(): Promise<void> {
  try {
    const claimed = await getDb()
      .update(refunds)
      .set({ donorNotifiedAt: new Date() })
      .where(and(eq(refunds.status, "completed"), isNull(refunds.donorNotifiedAt)))
      .returning({ id: refunds.id });
    if (claimed.length) await emailDonorsAboutRefund(claimed.map((c) => c.id));
  } catch (e) {
    console.error("Refund notification failed", e instanceof Error ? e.message : e);
  }
}

type PayPalRefundView = { state: "completed"; paypalRefundId: string } | { state: "pending" | "absent" | "failed" };

async function refundOnPayPal(orderId: string | null, refundRowId: string): Promise<PayPalRefundView> {
  if (!orderId) return { state: "absent" };
  const found = (await getOrderPayments(orderId)).refunds.find((r) => r.invoiceId === refundRowId);
  if (!found) return { state: "absent" };
  if (found.status === "COMPLETED") return { state: "completed", paypalRefundId: found.id };
  if (found.status === "PENDING") return { state: "pending" };
  return { state: "failed" };
}

/** One refund row, sent at most once. Same rules as captures: definite refusals fail, anything uncertain is checked on PayPal. */
async function refundOnce(r: RefundRow, checkFirst: boolean): Promise<boolean> {
  try {
    if (checkFirst) {
      const view = await refundOnPayPal(r.orderId, r.id);
      if (view.state === "completed") return recordRefundSuccess(r, view.paypalRefundId, "system").then(() => true);
      if (view.state === "pending") return false;
    }
    if (!r.paypalCaptureId || !r.merchantId) throw new Error("capture or charity merchant ID missing");
    const res = await refundCapture(r.paypalCaptureId, cents(r.amountCents), r.requestId, r.id, r.merchantId);
    if (res.status === "COMPLETED") {
      await recordRefundSuccess(r, res.refundId, "system");
      return true;
    }
    if (res.status === "PENDING") return false;
    await markRefundFailed(r.id);
    return false;
  } catch (e) {
    const issues = e instanceof PayPalError ? e.issues : [];
    console.error("Refund problem", { refundId: r.id, status: e instanceof PayPalError ? e.status : undefined, issues, error: e instanceof Error ? e.message : e });
    const duplicate = issues.includes("DUPLICATE_INVOICE_ID") || issues.includes("DUPLICATE_TRANSACTION");
    const definite = e instanceof PayPalError && e.status >= 400 && e.status < 500 && !duplicate;
    if (definite) {
      await markRefundFailed(r.id);
      return false;
    }
    try {
      const view = await refundOnPayPal(r.orderId, r.id);
      if (view.state === "completed") {
        await recordRefundSuccess(r, view.paypalRefundId, "system");
        return true;
      }
      if (view.state === "failed") await markRefundFailed(r.id);
    } catch {
      // PayPal unreachable: leave it pending; a retry checks first.
    }
    return false;
  }
}

async function markRefundFailed(id: string) {
  await getDb().update(refunds).set({ status: "failed" }).where(and(eq(refunds.id, id), eq(refunds.status, "pending")));
}

/**
 * Records a refund PayPal completed: refund row, capture and donation totals,
 * ledger. Used by the refund flow, retries and the PayPal webhook; only the
 * first call for a refund row changes anything.
 */
export async function recordRefundSuccess(
  r: { id: string; captureId: string; donationId: string; charityId: string; amountCents: number },
  paypalRefundId: string,
  actor: "system" | "paypal_webhook",
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [upd] = await tx
      .update(refunds)
      .set({ status: "completed", paypalRefundId })
      .where(and(eq(refunds.id, r.id), ne(refunds.status, "completed"), isNull(refunds.paypalRefundId)))
      .returning({ id: refunds.id });
    if (!upd) return false;
    await tx.update(captures).set({ refundedCents: sql`${captures.refundedCents} + ${r.amountCents}` }).where(eq(captures.id, r.captureId));
    const [don] = await tx
      .update(donations)
      .set({ refundedCents: sql`${donations.refundedCents} + ${r.amountCents}` })
      .where(eq(donations.id, r.donationId))
      .returning({ id: donations.id });
    if (!don) throw new Error("refund's donation not found"); // rolls back: capture, donation and ledger move together
    await tx.insert(ledgerEntries).values({
      charityId: r.charityId,
      donationId: r.donationId,
      captureId: r.captureId,
      event: "refunded",
      amountCents: r.amountCents,
      paypalReference: paypalRefundId,
      actorType: actor,
      details: { refundId: r.id },
    });
    return true;
  });
}
