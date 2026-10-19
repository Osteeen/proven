import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { CharityContext, ReviewerContext } from "@/server/auth/access";
// Database-only scope helper: keeps Auth.js out of this module (and its tests).
import { reviewerMayActOn } from "@/server/auth/scope";
import { getDb } from "@/server/db/client";
import { captures, charities, donations, ledgerEntries, memberships, needPriceChecks, needs, proofs, releases, supplierPayments, suppliers } from "@/server/db/schema";
import { cents, formatUsd, toCents } from "@/server/money";
import { PayPalError } from "@/server/paypal/client";
import { captureAuthorization, getOrderCaptures, voidAuthorization } from "@/server/paypal/orders";
import { emailDonorsAfterSettlement } from "./emails";
import { authorizationForCapture } from "./holds";
import { SECOND_CHECKS, advanceCapCents, allocate, finalReleaseBlock, proofChecked, reviewReason, type ReleaseProof } from "./rules";

export class ReleaseError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_HOLDS = ["authorized", "partially_captured"] as const;
/** A release approved or executing for this long has stopped (crash or timeout) and may be retried. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Locks a need. With `charityId`, only that charity's need is found - other charities get "not found". */
async function lockNeed(tx: Tx, needId: string, charityId?: string) {
  if (!UUID.test(needId)) return undefined;
  const [need] = await tx
    .select({
      id: needs.id,
      charityId: needs.charityId,
      amountCents: needs.amountCents,
      status: needs.status,
      fundingModel: needs.fundingModel,
      requiredProof: needs.requiredProof,
      charityStatus: charities.status,
      trustTier: charities.trustTier,
      thresholdCents: charities.reviewReleasesAboveCents,
      merchantId: charities.paypalMerchantId,
    })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(charityId ? and(eq(needs.id, needId), eq(needs.charityId, charityId)) : eq(needs.id, needId))
    .for("update", { of: needs });
  return need;
}

/** What the final-release rule looks at, read inside the caller's transaction (the need is locked). */
export async function releaseProof(tx: Tx, need: { id: string; requiredProof: string[] }): Promise<ReleaseProof> {
  const byKind = await tx
    .select({ kind: proofs.kind, status: proofs.status, n: sql<number>`count(*)::int` })
    .from(proofs)
    .where(eq(proofs.needId, need.id))
    .groupBy(proofs.kind, proofs.status);
  // Supplier money counts only while every link in the chain still stands: the payment
  // completed and isn't disputed, the supplier is verified, and its proof passes.
  const [paid] = await tx
    .select({ c: sql<number>`coalesce(sum(${supplierPayments.amountCents}), 0)::int` })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .innerJoin(proofs, eq(proofs.id, supplierPayments.proofId))
    .where(
      and(
        eq(supplierPayments.needId, need.id),
        eq(supplierPayments.status, "completed"),
        isNull(supplierPayments.disputedAt),
        eq(suppliers.status, "connected"),
        isNotNull(suppliers.verifiedAt),
        eq(proofs.status, "passed"),
      ),
    );
  const [taken] = await tx
    .select({ c: sql<number>`coalesce(sum(${donations.capturedCents}), 0)::int` })
    .from(donations)
    .where(eq(donations.needId, need.id));
  return {
    requiresSupplierPayment: need.requiredProof.includes("supplier_paypal_payment"),
    supplierPaidCents: paid?.c ?? 0,
    passedKinds: [...new Set(byKind.filter((r) => r.status === "passed").map((r) => r.kind))],
    reviewKinds: [...new Set(byKind.filter((r) => r.status === "needs_review").map((r) => r.kind))],
    requiredSecondChecks: need.requiredProof.filter((k) => (SECOND_CHECKS as readonly string[]).includes(k)),
    openIssues: byKind.filter((r) => r.status !== "passed").reduce((s, r) => s + r.n, 0),
    releasedCents: taken?.c ?? 0,
  };
}

/** The release rule's inputs for the charity's own need page - the same numbers the release itself is checked against. */
export async function getReleaseProof(ctx: CharityContext, needId: string): Promise<ReleaseProof | null> {
  if (!UUID.test(needId)) return null;
  return getDb().transaction(async (tx) => {
    const [need] = await tx
      .select({ id: needs.id, requiredProof: needs.requiredProof })
      .from(needs)
      .where(and(eq(needs.id, needId), eq(needs.charityId, ctx.charityId)))
      .limit(1);
    return need ? releaseProof(tx, need) : null;
  });
}

async function liveHolds(tx: Tx, needId: string) {
  return tx
    .select({
      id: donations.id,
      amountCents: donations.amountCents,
      capturedCents: donations.capturedCents,
      authorizationId: donations.paypalAuthorizationId,
    })
    .from(donations)
    .where(and(eq(donations.needId, needId), inArray(donations.status, [...LIVE_HOLDS])))
    .orderBy(asc(donations.createdAt))
    .for("update");
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/**
 * A charity asks for money from a need's holds: an advance (staged needs only,
 * capped) or the final release after delivery. Goes straight to PayPal unless a
 * person has to review it first.
 */
export async function requestRelease(
  ctx: CharityContext,
  needId: string,
  input: { kind: "advance" | "final"; amountCents: number; note?: string },
): Promise<{ releaseId: string; status: "pending_review" | "completed" | "failed" }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 100) throw new ReleaseError("Enter at least $1.00");
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    // Ownership: the need must belong to the signed-in charity.
    const need = await lockNeed(tx, needId, ctx.charityId);
    if (!need) throw new ReleaseError("Need not found.");
    if (need.charityStatus !== "active") throw new ReleaseError("Your charity's account is on hold, so money can't be released. Contact Proven.");
    if (need.status !== "open") throw new ReleaseError("This need isn't open for releases.");
    if (input.kind === "advance" && need.fundingModel !== "staged") throw new ReleaseError("This need releases money only after delivery.");

    const holds = await liveHolds(tx, need.id);
    const held = holds.reduce((s, h) => s + h.amountCents - h.capturedCents, 0);
    if (held === 0) throw new ReleaseError("Nothing is held for this need yet.");
    if (input.amountCents > held) throw new ReleaseError(`Only ${formatUsd(held)} is held.`);

    if (input.kind === "advance") {
      const [taken] = await tx
        .select({ c: sql<number>`coalesce(sum(${donations.capturedCents}), 0)::int` })
        .from(donations)
        .where(eq(donations.needId, need.id));
      const cap = advanceCapCents(need.amountCents, need.trustTier) - (taken?.c ?? 0);
      if (input.amountCents > cap) throw new ReleaseError(`Up front you can take up to ${formatUsd(Math.max(0, cap))} - the rest is released after delivery.`);
    }

    const [stuck] = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.needId, need.id), eq(releases.status, "failed")))
      .limit(1);
    if (stuck) throw new ReleaseError("An earlier release for this need didn't finish. It has to be retried first.");

    // The final-release rule: PayPal supplier payment + a second check, capped at what suppliers were paid.
    const proof = await releaseProof(tx, need);
    if (input.kind === "final") {
      const block = finalReleaseBlock(proof, input.amountCents);
      if (block) throw new ReleaseError(block);
    }

    // Only a completed DELIVERY release counts as a track record - a small
    // advance must not unlock unreviewed final releases for a new charity.
    const [done] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(releases)
      .where(and(eq(releases.charityId, need.charityId), eq(releases.status, "completed"), eq(releases.kind, "final")));
    const reason = reviewReason({
      kind: input.kind,
      trustTier: need.trustTier,
      completedReleases: done?.n ?? 0,
      amountCents: input.amountCents,
      thresholdCents: need.thresholdCents,
      proofChecked: proofChecked(proof),
      requiresSupplierPayment: proof.requiresSupplierPayment,
      priceWellAboveMarket: await tx
        .select({ v: needPriceChecks.verdict })
        .from(needPriceChecks)
        .where(eq(needPriceChecks.needId, need.id))
        .then((r) => r[0]?.v === "well_above"),
    });

    let row;
    try {
      [row] = await tx
        .insert(releases)
        .values({
          needId: need.id,
          charityId: need.charityId,
          kind: input.kind,
          amountCents: input.amountCents,
          status: reason ? "pending_review" : "approved",
          reviewReason: reason,
          note: input.note?.slice(0, 500) || null,
          requestedBy: ctx.userId,
        })
        .returning({ id: releases.id, status: releases.status });
    } catch (e) {
      // The partial unique index: another release for this need is already in flight.
      if (isUniqueViolation(e)) throw new ReleaseError("A release for this need is already in progress.");
      throw e;
    }
    // A final release closes the need to new gifts while it is checked and paid.
    if (input.kind === "final") await tx.update(needs).set({ status: "in_review" }).where(eq(needs.id, need.id));
    return row!;
  });

  if (created.status === "pending_review") return { releaseId: created.id, status: "pending_review" };
  return { releaseId: created.id, status: await executeRelease(created.id) };
}

/** A reviewer approves a waiting release; it then goes to PayPal. Nobody approves their own charity's money. */
export async function approveRelease(reviewer: ReviewerContext, releaseId: string): Promise<"completed" | "failed"> {
  if (!UUID.test(releaseId)) throw new ReleaseError("Release not found.");
  const db = getDb();
  const [rel] = await db.select({ charityId: releases.charityId, requestedBy: releases.requestedBy }).from(releases).where(eq(releases.id, releaseId)).limit(1);
  if (!rel || !(await reviewerMayActOn(reviewer, rel.charityId))) throw new ReleaseError("Release not found.");
  const [member] = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, reviewer.userId), eq(memberships.charityId, rel.charityId)))
    .limit(1);
  if (member || rel.requestedBy === reviewer.userId) throw new ReleaseError("You can't approve a release for a charity you belong to.");

  const [row] = await db
    .update(releases)
    .set({ status: "approved", reviewedBy: reviewer.userId, reviewedAt: new Date() })
    .where(and(eq(releases.id, releaseId), eq(releases.status, "pending_review")))
    .returning({ id: releases.id });
  if (!row) throw new ReleaseError("This release isn't waiting for review.");
  return executeRelease(row.id);
}

/** A reviewer turns a release down. The need reopens so the charity can respond. */
export async function rejectRelease(reviewer: ReviewerContext, releaseId: string, note?: string): Promise<void> {
  if (!UUID.test(releaseId)) throw new ReleaseError("Release not found.");
  const [rel] = await getDb().select({ charityId: releases.charityId }).from(releases).where(eq(releases.id, releaseId)).limit(1);
  if (!rel || !(await reviewerMayActOn(reviewer, rel.charityId))) throw new ReleaseError("Release not found.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(releases)
      .set({ status: "rejected", reviewedBy: reviewer.userId, reviewedAt: new Date(), note: note?.slice(0, 500) || null })
      .where(and(eq(releases.id, releaseId), eq(releases.status, "pending_review")))
      .returning({ needId: releases.needId, kind: releases.kind });
    if (!row) throw new ReleaseError("This release isn't waiting for review.");
    if (row.kind === "final") await tx.update(needs).set({ status: "open" }).where(and(eq(needs.id, row.needId), eq(needs.status, "in_review")));
  });
}

type PlannedCapture = {
  id: string;
  donationId: string;
  amountCents: number;
  requestId: string;
  final: boolean;
  authorizationId: string | null;
  orderId: string | null;
};

// "unclear" = PayPal shows a capture we can't book safely (a different amount, a reversal, a
// status we don't know): never booked, never called failed, never captured again - a person looks.
type PayPalView = { state: "completed"; paypalCaptureId: string } | { state: "pending" | "absent" | "declined" | "unclear" };

/**
 * What PayPal's own record says about one of our capture rows (matched on the invoice ID
 * we sent). If PayPal lists several, the one that moved money wins. A completed capture
 * counts only when its amount is exactly our row's.
 */
async function onPayPal(orderId: string | null, captureRowId: string, amountCents: number): Promise<PayPalView> {
  if (!orderId) return { state: "absent" };
  const rank = (status: string) => (MONEY_TAKEN.includes(status) ? 0 : status === "PENDING" ? 1 : status === "DECLINED" || status === "FAILED" ? 3 : 2);
  const found = (await getOrderCaptures(orderId)).filter((c) => c.invoiceId === captureRowId).sort((a, b) => rank(a.status) - rank(b.status))[0];
  if (!found) return { state: "absent" };
  if (MONEY_TAKEN.includes(found.status)) {
    let paid: number | null = null;
    try {
      paid = found.amountValue ? toCents(found.amountValue) : null;
    } catch {
      paid = null;
    }
    if (paid !== amountCents) {
      console.error("PayPal capture amount differs from our record - needs a person", { captureRowId, paypalCaptureId: found.id });
      return { state: "unclear" };
    }
    return { state: "completed", paypalCaptureId: found.id };
  }
  if (found.status === "PENDING") return { state: "pending" };
  if (found.status === "DECLINED" || found.status === "FAILED") return { state: "declined" };
  // REVERSED (a chargeback after money moved) or anything new: not ours to settle.
  console.error("PayPal capture in a state we don't book - needs a person", { captureRowId, status: found.status });
  return { state: "unclear" };
}

/** Capture statuses where PayPal did take the money (refunds are booked as their own events). */
const MONEY_TAKEN = ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"];

/** A reviewer retries a release that failed or stopped on PayPal. */
export async function retryRelease(reviewer: ReviewerContext, releaseId: string): Promise<"completed" | "failed"> {
  if (!UUID.test(releaseId)) throw new ReleaseError("Release not found.");
  const [rel] = await getDb().select({ charityId: releases.charityId }).from(releases).where(eq(releases.id, releaseId)).limit(1);
  if (!rel || !(await reviewerMayActOn(reviewer, rel.charityId))) throw new ReleaseError("Release not found.");
  return executeRelease(releaseId, { allowStuck: true });
}

/**
 * Does the money movement for an approved release, or retries a failed or
 * stuck one: splits it across donors, and captures each share on PayPal. Each
 * capture carries a stored request ID and our row ID as invoice ID, and on any
 * retry PayPal's own record is checked first - so a share is never charged
 * twice, even after a lost reply. A final release then cancels what is left.
 */
export async function executeRelease(releaseId: string, opts: { allowStuck?: boolean } = {}): Promise<"completed" | "failed"> {
  if (!UUID.test(releaseId)) throw new ReleaseError("Release not found.");
  const db = getDb();
  // A stuck release (approved or executing for 10+ minutes) can be picked up again;
  // one that is executing right now never runs twice in parallel.
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS);

  const plan = await db.transaction(async (tx) => {
    const [rel] = await tx
      .select()
      .from(releases)
      .where(
        and(
          eq(releases.id, releaseId),
          opts.allowStuck
            ? or(inArray(releases.status, ["approved", "failed"]), and(eq(releases.status, "executing"), lt(releases.updatedAt, stuckBefore)))
            : inArray(releases.status, ["approved", "failed"]),
        ),
      )
      .for("update");
    if (!rel) throw new ReleaseError("This release can't run right now.");
    const need = await lockNeed(tx, rel.needId);
    if (!need) throw new ReleaseError("Need not found.");
    const reject = async (note: string) => {
      await tx.update(releases).set({ status: "rejected", note }).where(eq(releases.id, rel.id));
      if (rel.kind === "final" && need.status === "in_review") await tx.update(needs).set({ status: "open" }).where(eq(needs.id, need.id));
      return { rejected: note };
    };
    if (need.status !== "open" && need.status !== "in_review") {
      // The need was closed meanwhile (its holds are being cancelled): never capture.
      await tx.update(releases).set({ status: "rejected", note: "Need closed before release ran" }).where(eq(releases.id, rel.id));
      return { rejected: "This need was closed, so the release was cancelled." };
    }

    const existing = await tx.select({ id: captures.id }).from(captures).where(eq(captures.releaseId, rel.id)).limit(1);
    if (existing.length === 0) {
      if (need.charityStatus !== "active") return reject("Charity account on hold - nothing was charged.");
      // Proof can change after the request (supplier refund, dispute, rejected supplier): check again before money moves.
      if (rel.kind === "final") {
        const block = finalReleaseBlock(await releaseProof(tx, need), rel.amountCents);
        if (block) return reject(`The proof changed since this was requested - nothing was charged. ${block}`);
      }
      const holds = await liveHolds(tx, need.id);
      const held = holds.reduce((s, h) => s + h.amountCents - h.capturedCents, 0);
      if (held < rel.amountCents) return reject("Held money changed since the request - nothing was charged. Request again.");
      const shares = allocate(
        rel.amountCents,
        holds.map((h) => ({ donationId: h.id, availableCents: h.amountCents - h.capturedCents })),
      );
      for (const s of shares.filter((x) => x.cents > 0)) {
        const [cap] = await tx
          .insert(captures)
          .values({
            donationId: s.donationId,
            charityId: need.charityId,
            releaseId: rel.id,
            amountCents: s.cents,
            reason: rel.kind === "advance" ? "booking_confirmed" : "delivery_proven",
            finalCapture: rel.kind === "final",
            requestId: randomUUID(),
            status: "pending",
          })
          .returning({ id: captures.id });
        await tx.insert(ledgerEntries).values({
          charityId: need.charityId,
          donationId: s.donationId,
          captureId: cap!.id,
          event: "capture_requested",
          amountCents: s.cents,
          actorType: "system",
          details: { releaseId: rel.id, kind: rel.kind },
        });
      }
    }
    await tx.update(releases).set({ status: "executing" }).where(eq(releases.id, rel.id));
    const todo: PlannedCapture[] = await tx
      .select({
        id: captures.id,
        donationId: captures.donationId,
        amountCents: captures.amountCents,
        requestId: captures.requestId,
        final: captures.finalCapture,
        authorizationId: donations.paypalAuthorizationId,
        orderId: donations.paypalOrderId,
      })
      .from(captures)
      .innerJoin(donations, eq(donations.id, captures.donationId))
      .where(and(eq(captures.releaseId, rel.id), inArray(captures.status, ["pending", "failed"])));
    return { rel, need, todo, retry: existing.length > 0 };
  });
  if ("rejected" in plan) throw new ReleaseError(plan.rejected);

  let unfinished = false;
  for (const c of plan.todo) {
    const done = await captureOnce({ ...c, charityId: plan.need.charityId, releaseId: plan.rel.id }, plan.retry);
    if (!done) unfinished = true;
  }

  if (!unfinished && plan.rel.kind === "final") {
    // Holds that got no share of the final release are cancelled: those donors are never charged.
    unfinished = !(await cancelRemainingHolds(plan.need.id, plan.need.charityId, plan.need.merchantId, "system"));
  }

  await db.transaction(async (tx) => {
    await tx.update(releases).set({ status: unfinished ? "failed" : "completed" }).where(eq(releases.id, plan.rel.id));
    if (!unfinished && plan.rel.kind === "final") await tx.update(needs).set({ status: "proven" }).where(eq(needs.id, plan.need.id));
  });
  if (!unfinished && plan.rel.kind === "final") await emailDonorsAfterSettlement(plan.need.id, "proven");
  return unfinished ? "failed" : "completed";
}

/**
 * One share, captured at most once. Returns true when PayPal has the money.
 * A definite PayPal refusal marks the share failed; anything uncertain (timeout,
 * lost reply, PayPal 5xx, duplicate) is checked against PayPal's record and
 * otherwise left pending, so the next retry checks again before capturing.
 */
async function captureOnce(c: PlannedCapture & { charityId: string; releaseId: string }, checkFirst: boolean): Promise<boolean> {
  const settle = async (view: PayPalView, issue?: string): Promise<boolean> => {
    if (view.state === "completed") {
      await recordCaptureSuccess(c, view.paypalCaptureId, "system");
      return true;
    }
    if (view.state === "declined" && issue) await markCaptureFailed(c, issue);
    return false;
  };

  try {
    if (checkFirst) {
      const view = await onPayPal(c.orderId, c.id, c.amountCents);
      // Already captured, still processing, or something a person must look at: never capture again.
      if (view.state === "completed" || view.state === "pending") return settle(view);
      if (view.state === "unclear") return false;
    }
    // After the honor period an uncharged hold is renewed first; captures use the current ID.
    const authId = await authorizationForCapture(c.donationId);
    if (!authId) throw new Error("donation has no authorization");
    const res = await captureAuthorization(authId, cents(c.amountCents), c.final, c.requestId, c.id);
    if (res.status === "COMPLETED") return settle({ state: "completed", paypalCaptureId: res.captureId });
    if (res.status === "PENDING") return false; // Finished later by the webhook or a retry's check.
    await markCaptureFailed(c, `PayPal capture status ${res.status}`);
    return false;
  } catch (e) {
    const issue = e instanceof PayPalError ? `${e.status} ${e.errorName ?? ""} ${e.issues.join(",")}`.trim() : e instanceof Error ? e.message : "unknown";
    console.error("Capture problem", { captureId: c.id, issue });
    const duplicate = e instanceof PayPalError && e.issues.some((i) => i === "DUPLICATE_TRANSACTION" || i === "DUPLICATE_INVOICE_ID");
    const definite = e instanceof PayPalError && e.status >= 400 && e.status < 500 && !duplicate;
    if (definite) {
      // Even a plain refusal is checked against PayPal's own record (our row ID is the
      // invoice ID) before anything is called failed: a share PayPal did take is
      // recorded as paid, never shown to the donor as uncharged.
      try {
        const view = await onPayPal(c.orderId, c.id, c.amountCents);
        if (view.state === "completed" || view.state === "pending") return settle(view);
        if (view.state === "unclear") return false; // Left open for a person - never called failed.
      } catch {
        return false; // PayPal unreachable: leave it pending. The next retry checks first.
      }
      await markCaptureFailed(c, issue);
      return false;
    }
    // Uncertain: PayPal may have the money. Look before deciding anything.
    try {
      return await settle(await onPayPal(c.orderId, c.id, c.amountCents), issue);
    } catch {
      return false; // PayPal unreachable: leave it pending. The next retry checks first.
    }
  }
}

async function markCaptureFailed(c: { id: string; donationId: string; amountCents: number; charityId: string; releaseId: string }, issue: string) {
  await getDb().transaction(async (tx) => {
    // Only a pending share can fail - never overwrite one already recorded as paid.
    const [upd] = await tx
      .update(captures)
      .set({ status: "failed" })
      .where(and(eq(captures.id, c.id), eq(captures.status, "pending")))
      .returning({ id: captures.id });
    if (!upd) return;
    await tx.insert(ledgerEntries).values({
      charityId: c.charityId,
      donationId: c.donationId,
      captureId: c.id,
      event: "capture_failed",
      amountCents: c.amountCents,
      actorType: "system",
      details: { releaseId: c.releaseId, issue },
    });
  });
}

/**
 * Before any hold is cancelled, our unfinished capture rows on the need are
 * checked against PayPal, so a capture whose reply was lost is recorded as a
 * charge instead of being reported as "never charged". Returns false if PayPal
 * couldn't be asked, or still has a capture in progress.
 */
async function reconcileNeedCaptures(needId: string): Promise<boolean> {
  const open = await getDb()
    .select({
      id: captures.id,
      donationId: captures.donationId,
      amountCents: captures.amountCents,
      final: captures.finalCapture,
      charityId: captures.charityId,
      releaseId: captures.releaseId,
      authorizationId: donations.paypalAuthorizationId,
      orderId: donations.paypalOrderId,
    })
    .from(captures)
    .innerJoin(donations, eq(donations.id, captures.donationId))
    .where(and(eq(donations.needId, needId), inArray(captures.status, ["pending", "failed"])));
  let ok = true;
  for (const c of open) {
    try {
      const view = await onPayPal(c.orderId, c.id, c.amountCents);
      if (view.state === "completed") await recordCaptureSuccess(c, view.paypalCaptureId, "system");
      // Still processing, or something only a person can settle: never void holds behind it.
      else if (view.state === "pending" || view.state === "unclear") ok = false;
    } catch (e) {
      ok = false;
      console.error("Couldn't check capture with PayPal", { captureId: c.id, error: e instanceof Error ? e.message : e });
    }
  }
  return ok;
}

/**
 * Cancels every hold on a need that still has money held. Where part was
 * already captured (an advance), the rest is released and recorded as such.
 * Returns false if anything couldn't be confirmed with PayPal (safe to run again).
 */
async function cancelRemainingHolds(needId: string, charityId: string, merchantId: string | null, actor: "system" | "reviewer" | "charity", actorId?: string): Promise<boolean> {
  const db = getDb();
  // Never void (and tell donors "never charged") while a charge is unaccounted for.
  if (!(await reconcileNeedCaptures(needId))) return false;

  let ok = true;
  const holds = await db
    .select({ id: donations.id, amountCents: donations.amountCents, capturedCents: donations.capturedCents, authorizationId: donations.paypalAuthorizationId })
    .from(donations)
    .where(and(eq(donations.needId, needId), inArray(donations.status, [...LIVE_HOLDS])));
  for (const h of holds) {
    const remaining = h.amountCents - h.capturedCents;
    try {
      if (!h.authorizationId || !merchantId) throw new Error("missing authorization or charity merchant ID");
      await voidAuthorization(h.authorizationId, merchantId, `${h.authorizationId}-void`);
    } catch (e) {
      const issues = e instanceof PayPalError ? e.issues : [];
      // Already voided on PayPal's side is fine. Already captured is fine only if
      // our records already show the whole hold charged - otherwise a person looks.
      const settled = issues.includes("AUTHORIZATION_VOIDED") || (issues.includes("AUTHORIZATION_ALREADY_CAPTURED") && remaining === 0);
      if (!settled) {
        ok = false;
        console.error("Void failed", { donationId: h.id, issues, error: e instanceof Error ? e.message : e });
        continue;
      }
    }
    await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(donations)
        .set({ status: h.capturedCents > 0 ? "captured" : "voided" })
        .where(and(eq(donations.id, h.id), inArray(donations.status, [...LIVE_HOLDS])))
        .returning({ id: donations.id });
      if (!upd) return; // Already recorded (by the webhook).
      await tx.insert(ledgerEntries).values({
        charityId,
        donationId: h.id,
        event: "voided",
        amountCents: remaining,
        paypalReference: h.authorizationId,
        actorType: actor,
        actorId: actorId ?? null,
        details: { reason: "released without charge" },
      });
    });
  }
  return ok;
}

/**
 * "Not proven": cancel the need and every hold on it. A charity cancels its own
 * need; a reviewer marks it not proven. Refused while a release is running.
 * Donors are emailed only once PayPal confirmed every hold is cancelled.
 */
export async function cancelNeed(
  actor: { kind: "charity"; ctx: CharityContext } | { kind: "reviewer"; ctx: ReviewerContext } | { kind: "system"; reason: string },
  needId: string,
): Promise<boolean> {
  const db = getDb();
  const need = await db.transaction(async (tx) => {
    const n = await lockNeed(tx, needId, actor.kind === "charity" ? actor.ctx.charityId : undefined);
    if (!n || (actor.kind === "reviewer" && !(await reviewerMayActOn(actor.ctx, n.charityId)))) throw new ReleaseError("Need not found.");
    if (!["open", "in_review", "funded", "delivering"].includes(n.status)) throw new ReleaseError("This need is already closed.");
    const running = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.needId, n.id), inArray(releases.status, ["approved", "executing"])))
      .limit(1);
    if (running.length) throw new ReleaseError("A release is running for this need. Try again in a moment.");
    // Waiting or failed releases die with the need. Anything already captured stays recorded.
    await tx
      .update(releases)
      .set({ status: "rejected", note: "Need cancelled" })
      .where(and(eq(releases.needId, n.id), inArray(releases.status, ["pending_review", "failed"])));
    await tx.update(needs).set({ status: actor.kind === "reviewer" ? "not_proven" : "cancelled" }).where(eq(needs.id, n.id));
    return n;
  });
  const ok = await cancelRemainingHolds(need.id, need.charityId, need.merchantId, actor.kind, actor.kind === "system" ? undefined : actor.ctx.userId);
  if (ok) await emailDonorsAfterSettlement(need.id, "released");
  return ok;
}

/**
 * Finishes cancelling a closed need whose holds PayPal didn't all confirm the
 * first time. Reviewers only; checks PayPal's record first like every cancel.
 */
export async function finishClosingNeed(reviewer: ReviewerContext, needId: string): Promise<boolean> {
  if (!UUID.test(needId)) throw new ReleaseError("Need not found.");
  const [n] = await getDb()
    .select({ id: needs.id, status: needs.status, charityId: needs.charityId, merchantId: charities.paypalMerchantId })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(eq(needs.id, needId))
    .limit(1);
  if (!n || !(await reviewerMayActOn(reviewer, n.charityId))) throw new ReleaseError("Need not found.");
  if (!["cancelled", "not_proven"].includes(n.status)) throw new ReleaseError("This need isn't closing.");
  const ok = await cancelRemainingHolds(n.id, n.charityId, n.merchantId, "reviewer", reviewer.userId);
  if (ok) await emailDonorsAfterSettlement(n.id, "released");
  return ok;
}

/**
 * Records a capture PayPal completed: capture row, donation totals, ledger.
 * Used by the release flow, retries, and the PayPal webhook. Safe to call any
 * number of times - only the first call for a capture row changes anything.
 */
export async function recordCaptureSuccess(
  c: { id: string; donationId: string; amountCents: number; final: boolean; authorizationId: string | null; charityId: string; releaseId: string | null },
  paypalCaptureId: string,
  actor: "system" | "paypal_webhook",
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [upd] = await tx
      .update(captures)
      .set({ status: "completed", paypalCaptureId })
      .where(and(eq(captures.id, c.id), ne(captures.status, "completed"), isNull(captures.paypalCaptureId)))
      .returning({ id: captures.id });
    if (!upd) return false;
    // Status only moves forward: a settled donation never becomes "held" again.
    await tx
      .update(donations)
      .set({
        capturedCents: sql`${donations.capturedCents} + ${c.amountCents}`,
        status: c.final
          ? sql`'captured'::donation_status`
          : sql`case when ${donations.status} in ('authorized', 'partially_captured') then 'partially_captured'::donation_status else 'captured'::donation_status end`,
      })
      .where(eq(donations.id, c.donationId));
    await tx.insert(ledgerEntries).values({
      charityId: c.charityId,
      donationId: c.donationId,
      captureId: c.id,
      event: "captured",
      amountCents: c.amountCents,
      paypalReference: paypalCaptureId,
      actorType: actor,
      details: { releaseId: c.releaseId, final: c.final },
    });
    if (c.final) {
      // A final capture tells PayPal to release whatever is left on the hold: record it.
      const [d] = await tx
        .select({ amountCents: donations.amountCents, capturedCents: donations.capturedCents })
        .from(donations)
        .where(eq(donations.id, c.donationId));
      const left = (d?.amountCents ?? 0) - (d?.capturedCents ?? 0);
      if (left > 0) {
        await tx.insert(ledgerEntries).values({
          charityId: c.charityId,
          donationId: c.donationId,
          event: "voided",
          amountCents: left,
          paypalReference: c.authorizationId,
          actorType: actor,
          details: { reason: "released by final capture" },
        });
      }
    }
    return true;
  });
}
