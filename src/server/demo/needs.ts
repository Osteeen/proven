import "server-only";
import { and, asc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
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
 * a live copy is posted again with a fresh deadline (live copies are kept fresh
 * by extendDemoDeadlines). Safe to run any number of times (deploy seed and daily job).
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
      .where(and(eq(needs.charityId, charity.id), eq(needs.demoSeed, true), inArray(needs.status, [...LIVE])));
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

/** Holds that still have money on them. */
const OPEN_HOLD = sql.raw("('authorized', 'partially_captured')");

/**
 * Daily, before closeStaleDemoNeeds: rolls each live seeded demo need's deadline
 * forward to its template's distance from today, so the demo cases (held money,
 * a payment waiting for review) stay live while judges look instead of closing on
 * a fixed date. Only moves deadlines later, and never past what PayPal allows:
 * a day before the earliest open hold lapses, and the 28-day window from posting
 * (the needs_deadline_window check). A need that can't move closes as before.
 * Demo charity only: real charities' deadlines never move.
 */
export async function extendDemoDeadlines(onlyCharityId?: string): Promise<number> {
  let moved = 0;
  for (const t of templates) {
    const rows = await getDb().execute(sql`
      with target as (
        select n.id,
               least(
                 date_trunc('day', now() + make_interval(days => ${t.days})) + interval '23 hours 59 minutes 59 seconds',
                 n.created_at + interval '28 days',
                 coalesce((select min(d.hold_expires_at) from donations d
                            where d.need_id = n.id and d.status in ${OPEN_HOLD}) - interval '1 day', 'infinity')
               ) as deadline
          from needs n join charities c on c.id = n.charity_id
         where c.is_demo and n.demo_seed and n.title = ${t.title}
           and n.status in ('open', 'funded', 'delivering', 'in_review')
           ${onlyCharityId ? sql`and c.id = ${onlyCharityId}` : sql``}
      )
      update needs n set deadline = target.deadline, updated_at = now()
        from target
       where n.id = target.id and target.deadline > n.deadline and target.deadline > now()
      returning n.id`);
    moved += rows.rows.length;
  }
  return moved;
}

/**
 * Daily: closes the demo charity's needs that visitors posted more than two days
 * ago, seeded needs past their deadline, seeded needs whose template was retired
 * (replaced in demo-needs.json), and duplicate seeded copies with no money on
 * them (keeping the copy that has money on it, else the newest). Closing cancels every hold - sandbox
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
          and(
            eq(needs.demoSeed, true),
            sql`not exists (select 1 from donations d where d.need_id = ${needs.id} and d.status in ('authorized', 'partially_captured', 'captured'))`,
            sql`exists (select 1 from needs o where o.charity_id = ${needs.charityId} and o.demo_seed and o.title = ${needs.title}
                          and o.id <> ${needs.id} and o.status in ('open', 'funded', 'delivering', 'in_review')
                          and (o.created_at > ${needs.createdAt}
                               or exists (select 1 from donations d where d.need_id = o.id and d.status in ('authorized', 'partially_captured', 'captured'))))`,
          ),
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
