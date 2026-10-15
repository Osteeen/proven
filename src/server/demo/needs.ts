import "server-only";
import { and, asc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities, needs } from "@/server/db/schema";
import type { ProofType } from "@/server/needs/input";
import { cancelNeed } from "@/server/releases/service";
import templates from "./demo-needs.json";

/** Needs a visitor posts as the demo charity are closed after this long, so the public list stays clean. */
export const DEMO_NEED_LIFETIME_MS = 2 * 86_400_000;
const LIVE = ["open", "funded", "delivering", "in_review"] as const;
const DAY_MS = 86_400_000;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Keeps the demo charity's seeded needs on the homepage: any template without
 * a live copy (closed, or within a day of its deadline) is posted again with a
 * fresh deadline. Safe to run any number of times (deploy seed and daily job).
 */
export async function refreshDemoNeeds(): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // One refresh at a time, so two runs can't both post the same need.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('proven-demo-needs'))`);
    // The seeded demo charity (the first one made), never a test copy.
    const [charity] = await tx
      .select({ id: charities.id })
      .from(charities)
      .where(and(eq(charities.isDemo, true), eq(charities.status, "active")))
      .orderBy(asc(charities.createdAt))
      .limit(1);
    if (!charity) return 0;
    const live = await tx
      .select({ title: needs.title })
      .from(needs)
      .where(and(eq(needs.charityId, charity.id), eq(needs.demoSeed, true), inArray(needs.status, [...LIVE]), gt(needs.deadline, new Date(Date.now() + DAY_MS))));
    const have = new Set(live.map((n) => n.title));
    let count = 0;
    for (const t of templates) {
      if (have.has(t.title)) continue;
      const now = Date.now();
      const [posted] = await tx.insert(needs).values({
        charityId: charity.id,
        title: t.title,
        description: t.description,
        amountCents: t.amountCents,
        // End of the day, inside the 28-day hold window.
        deadline: new Date(new Date(now + t.days * DAY_MS).setUTCHours(23, 59, 59, 0)),
        fundingModel: "reimbursement",
        requiredProof: t.requiredProof as ProofType[],
        status: "open",
        demoSeed: true,
        createdAt: new Date(now),
      }).returning({ id: needs.id });
      await inheritPriceCheck(tx, posted!.id, charity.id, t);
      count++;
    }
    return count;
  });
}

/**
 * A re-posted demo copy keeps the last price result for the same template (same
 * words and price), so the demo shows the same verdict every time instead of a
 * fresh, possibly different, live search. The deploy seed does the same.
 */
async function inheritPriceCheck(tx: Tx, needId: string, charityId: string, t: { title: string; description: string; amountCents: number }) {
  await tx.execute(sql`
    insert into need_price_checks (need_id, status, item, quantity, unit_cents, market_median_cents, market_low_cents,
           market_high_cents, comparable_count, verdict, listings, attempts, checked_at)
    select ${needId}, p.status, p.item, p.quantity, p.unit_cents, p.market_median_cents, p.market_low_cents,
           p.market_high_cents, p.comparable_count, p.verdict, p.listings, 1, p.checked_at
      from need_price_checks p join needs n on n.id = p.need_id
     where n.charity_id = ${charityId} and n.demo_seed and n.id <> ${needId} and n.title = ${t.title}
       and n.description = ${t.description} and n.amount_cents = ${t.amountCents} and p.status = 'checked'
     order by p.checked_at desc limit 1
    on conflict (need_id) do nothing`);
}

/**
 * Daily: closes the demo charity's needs that visitors posted more than two days
 * ago, seeded needs past their deadline, and seeded needs whose template was
 * retired (replaced in demo-needs.json). Closing cancels every hold - sandbox
 * donors are never charged - exactly as a charity closing its own need.
 */
export async function closeStaleDemoNeeds(onlyCharityId?: string): Promise<number> {
  const stale = await getDb()
    .select({ id: needs.id })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(
      and(
        eq(charities.isDemo, true),
        onlyCharityId ? eq(charities.id, onlyCharityId) : undefined,
        inArray(needs.status, [...LIVE]),
        or(
          and(eq(needs.demoSeed, false), lt(needs.createdAt, new Date(Date.now() - DEMO_NEED_LIFETIME_MS))),
          and(eq(needs.demoSeed, true), lt(needs.deadline, new Date())),
          and(eq(needs.demoSeed, true), notInArray(needs.title, templates.map((t) => t.title))),
        ),
      ),
    )
    .limit(50);
  let closed = 0;
  for (const s of stale) {
    try {
      await cancelNeed({ kind: "system", reason: "Demo need cleared" }, s.id);
      closed++;
    } catch {
      // A release is running on it: tried again tomorrow.
    }
  }
  return closed;
}
