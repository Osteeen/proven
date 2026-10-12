import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { reviewerCharityScope, type CharityContext, type ReviewerContext } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { charities, donations, needs, refunds, releases, webhookEvents } from "@/server/db/schema";
import { advanceCapCents } from "./rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACED = ["authorized", "partially_captured", "captured", "voided", "expired"] as const;

/**
 * One need as its own charity sees it: money held, charged and released, each
 * hold (no donor identities), and every release. Another charity's need is
 * "not found".
 */
export async function getNeedForCharity(ctx: CharityContext, needId: string) {
  if (!UUID.test(needId)) return undefined;
  const db = getDb();
  const [need] = await db
    .select({
      id: needs.id,
      title: needs.title,
      status: needs.status,
      amountCents: needs.amountCents,
      deadline: needs.deadline,
      fundingModel: needs.fundingModel,
      requiredProof: needs.requiredProof,
      trustTier: charities.trustTier,
      thresholdCents: charities.reviewReleasesAboveCents,
    })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(and(eq(needs.id, needId), eq(needs.charityId, ctx.charityId)))
    .limit(1);
  if (!need) return undefined;

  const [holds, rels, done] = await Promise.all([
    db
      .select({
        amountCents: donations.amountCents,
        capturedCents: donations.capturedCents,
        refundedCents: donations.refundedCents,
        status: donations.status,
        at: donations.authorizedAt,
        expiresAt: donations.holdExpiresAt,
        gift: donations.donorAccessHash,
      })
      .from(donations)
      .where(and(eq(donations.needId, need.id), eq(donations.charityId, ctx.charityId), inArray(donations.status, [...PLACED])))
      .orderBy(asc(donations.createdAt)),
    db
      .select({
        id: releases.id,
        kind: releases.kind,
        amountCents: releases.amountCents,
        status: releases.status,
        reviewReason: releases.reviewReason,
        note: releases.note,
        createdAt: releases.createdAt,
      })
      .from(releases)
      .where(and(eq(releases.needId, need.id), eq(releases.charityId, ctx.charityId)))
      .orderBy(desc(releases.createdAt)),
    db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.charityId, ctx.charityId), eq(releases.status, "completed"), eq(releases.kind, "final"))),
  ]);

  const giftNumber = new Map<string, number>();
  for (const h of holds) if (!giftNumber.has(h.gift)) giftNumber.set(h.gift, giftNumber.size + 1);
  const live = holds.filter((h) => h.status === "authorized" || h.status === "partially_captured");
  const heldCents = live.reduce((s, h) => s + h.amountCents - h.capturedCents, 0);
  const chargedCents = holds.reduce((s, h) => s + h.capturedCents, 0);
  const releasedCents = holds.reduce((s, h) => s + h.amountCents, 0) - heldCents - chargedCents;
  const refundedCents = holds.reduce((s, h) => s + h.refundedCents, 0);
  const advanceLeftCents =
    need.fundingModel === "staged" ? Math.max(0, Math.min(heldCents, advanceCapCents(need.amountCents, need.trustTier) - chargedCents)) : 0;
  const expiries = live.map((h) => h.expiresAt).filter((d): d is Date => Boolean(d));

  return {
    ...need,
    // Donors stay anonymous: numbered by gift link, never identified. The hash itself never leaves the server.
    holds: holds.map(({ gift, ...h }, i) => {
      const n = giftNumber.get(gift)!;
      const first = holds.findIndex((x) => x.gift === gift) === i;
      return { key: `${n}-${i}`, label: first ? `Donor ${n}` : `Donor ${n} - added`, ...h };
    }),
    liveDonors: new Set(live.map((h) => h.gift)).size,
    releases: rels,
    heldCents,
    chargedCents,
    refundedCents,
    releasedCents,
    advanceLeftCents,
    firstHoldExpiresAt: expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : undefined,
    inFlight: rels.find((r) => ["pending_review", "approved", "executing", "failed"].includes(r.status)),
    completedReleases: done.length,
  };
}

/** A release still approved/executing after this long has stopped (crash or timeout) and needs a person. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

/**
 * Reviewers only: releases waiting for a person, ones that failed or stopped
 * on PayPal and need a retry, and closed needs whose holds PayPal hasn't all
 * confirmed as cancelled.
 */
export async function listReviewQueue(reviewer: ReviewerContext, now: Date) {
  const db = getDb();
  // Demo reviewers see only demo charities; an empty scope sees nothing.
  const scope = await reviewerCharityScope(reviewer);
  const inScope = (col: typeof releases.charityId | typeof donations.charityId) => (scope === null ? undefined : scope.length ? inArray(col, scope) : sql`false`);
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const rows = await db
    .select({
      id: releases.id,
      kind: releases.kind,
      amountCents: releases.amountCents,
      status: releases.status,
      reviewReason: releases.reviewReason,
      note: releases.note,
      createdAt: releases.createdAt,
      requestedBy: releases.requestedBy,
      needId: needs.id,
      needTitle: needs.title,
      needAmountCents: needs.amountCents,
      deadline: needs.deadline,
      requiredProof: needs.requiredProof,
      charityName: charities.name,
      trustTier: charities.trustTier,
    })
    .from(releases)
    .innerJoin(needs, and(eq(needs.id, releases.needId), eq(needs.charityId, releases.charityId)))
    .innerJoin(charities, eq(charities.id, releases.charityId))
    .where(
      and(
        inScope(releases.charityId),
        or(
          inArray(releases.status, ["pending_review", "failed"]),
          and(inArray(releases.status, ["approved", "executing"]), lt(releases.updatedAt, stuckBefore)),
        ),
      ),
    )
    .orderBy(asc(releases.createdAt));

  const needIds = [...new Set(rows.map((r) => r.needId))];
  const holds = needIds.length
    ? await db
        .select({ needId: donations.needId, amountCents: donations.amountCents, capturedCents: donations.capturedCents })
        .from(donations)
        .where(and(inArray(donations.needId, needIds), inArray(donations.status, ["authorized", "partially_captured"])))
    : [];
  const heldBy = new Map<string, number>();
  for (const h of holds) heldBy.set(h.needId, (heldBy.get(h.needId) ?? 0) + h.amountCents - h.capturedCents);

  const closing = await db
    .select({ needId: needs.id, needTitle: needs.title, status: needs.status, charityName: charities.name, amountCents: donations.amountCents, capturedCents: donations.capturedCents })
    .from(donations)
    .innerJoin(needs, and(eq(needs.id, donations.needId), eq(needs.charityId, donations.charityId)))
    .innerJoin(charities, eq(charities.id, donations.charityId))
    .where(and(inScope(donations.charityId), inArray(needs.status, ["cancelled", "not_proven"]), inArray(donations.status, ["authorized", "partially_captured"])));
  const closingBy = new Map<string, { needId: string; needTitle: string; charityName: string; heldCents: number; holds: number }>();
  for (const c of closing) {
    const cur = closingBy.get(c.needId) ?? { needId: c.needId, needTitle: c.needTitle, charityName: c.charityName, heldCents: 0, holds: 0 };
    cur.heldCents += c.amountCents - c.capturedCents;
    cur.holds += 1;
    closingBy.set(c.needId, cur);
  }

  return {
    releases: rows.map((r) => ({ ...r, heldCents: heldBy.get(r.needId) ?? 0 })),
    closing: [...closingBy.values()],
  };
}

/** Needs where donors were charged and something is still refundable, for reviewers (scoped like the queue). */
export async function listRefundableNeeds(reviewer: ReviewerContext) {
  const scope = await reviewerCharityScope(reviewer);
  if (scope !== null && scope.length === 0) return [];
  return getDb()
    .select({
      needId: needs.id,
      needTitle: needs.title,
      needStatus: needs.status,
      charityName: charities.name,
      chargedCents: sql<number>`sum(${donations.capturedCents})::int`,
      refundedCents: sql<number>`sum(${donations.refundedCents})::int`,
    })
    .from(donations)
    .innerJoin(needs, and(eq(needs.id, donations.needId), eq(needs.charityId, donations.charityId)))
    .innerJoin(charities, eq(charities.id, donations.charityId))
    .where(scope === null ? gt(donations.capturedCents, 0) : and(gt(donations.capturedCents, 0), inArray(donations.charityId, scope)))
    .groupBy(needs.id, needs.title, needs.status, charities.name)
    .having(sql`sum(${donations.capturedCents}) > sum(${donations.refundedCents})`)
    .orderBy(desc(sql`max(${donations.updatedAt})`));
}

/** One need as a reviewer sees it for refunds: charges, refunds so far, gifts (anonymous). */
export async function getNeedForReviewer(reviewer: ReviewerContext, needId: string) {
  if (!UUID.test(needId)) return undefined;
  const db = getDb();
  const [need] = await db
    .select({ id: needs.id, title: needs.title, status: needs.status, amountCents: needs.amountCents, charityId: needs.charityId, charityName: charities.name })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(eq(needs.id, needId))
    .limit(1);
  const scope = await reviewerCharityScope(reviewer);
  if (!need || (scope !== null && !scope.includes(need.charityId))) return undefined;

  const [gifts, refundRows] = await Promise.all([
    db
      .select({ gift: donations.donorAccessHash, capturedCents: donations.capturedCents, refundedCents: donations.refundedCents })
      .from(donations)
      .where(and(eq(donations.needId, need.id), gt(donations.capturedCents, 0))),
    db
      .select({ batchId: refunds.batchId, amountCents: refunds.amountCents, status: refunds.status, reason: refunds.reason, createdAt: refunds.createdAt, updatedAt: refunds.updatedAt })
      .from(refunds)
      .where(eq(refunds.needId, need.id))
      .orderBy(desc(refunds.createdAt)),
  ]);
  const byGift = new Map<string, { chargedCents: number; refundedCents: number }>();
  for (const g of gifts) {
    const cur = byGift.get(g.gift) ?? { chargedCents: 0, refundedCents: 0 };
    cur.chargedCents += g.capturedCents;
    cur.refundedCents += g.refundedCents;
    byGift.set(g.gift, cur);
  }
  const batches = new Map<string, { batchId: string; amountCents: number; refundedCents: number; pending: boolean; failed: boolean; reason: string; createdAt: Date; lastUpdate: number }>();
  for (const r of refundRows) {
    const cur = batches.get(r.batchId) ?? { batchId: r.batchId, amountCents: 0, refundedCents: 0, pending: false, failed: false, reason: r.reason, createdAt: r.createdAt, lastUpdate: 0 };
    cur.lastUpdate = Math.max(cur.lastUpdate, r.updatedAt.getTime());
    cur.amountCents += r.amountCents;
    if (r.status === "completed") cur.refundedCents += r.amountCents;
    cur.pending ||= r.status === "pending";
    cur.failed ||= r.status === "failed";
    batches.set(r.batchId, cur);
  }
  const chargedCents = gifts.reduce((s, g) => s + g.capturedCents, 0);
  const refundedCents = gifts.reduce((s, g) => s + g.refundedCents, 0);
  return {
    ...need,
    chargedCents,
    refundedCents,
    refundableCents: chargedCents - refundedCents,
    gifts: [...byGift.values()].map((g, i) => ({ label: `Donor ${i + 1}`, ...g })),
    refunds: [...batches.values()],
  };
}

/** PayPal events we couldn't match to our own records (e.g. a refund made outside Proven). Real reviewers only. */
export async function listWebhookAlerts(reviewer: ReviewerContext) {
  if (reviewer.isDemo) return [];
  return getDb()
    .select({ id: webhookEvents.id, eventType: webhookEvents.eventType, resourceId: webhookEvents.resourceId, outcome: webhookEvents.outcome, receivedAt: webhookEvents.receivedAt })
    .from(webhookEvents)
    .where(sql`${webhookEvents.outcome} like '%needs review%'`)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(20);
}
