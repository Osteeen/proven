import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities, donations, needs } from "@/server/db/schema";
import type { CharityContext } from "@/server/auth/access";
import type { NeedInput } from "./input";

const PUBLIC_STATUSES = ["open", "funded", "delivering", "in_review", "proven", "not_proven"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Money still on hold for a need: authorized minus anything already captured.
const heldCents = sql<number>`coalesce(sum(case when ${donations.status} in ('authorized', 'partially_captured')
  then ${donations.amountCents} - ${donations.capturedCents} else 0 end), 0)::int`;
// Paid to the charity: charged minus anything later refunded to donors.
const capturedCents = sql<number>`coalesce(sum(${donations.capturedCents} - ${donations.refundedCents}), 0)::int`;
// One donor = one private gift link: holds added to the same gift count once.
const donorCount = sql<number>`count(distinct ${donations.donorAccessHash}) filter (where ${donations.status} <> 'pending_approval' and ${donations.status} <> 'failed')::int`;

/** Creates a need for the signed-in charity. The charity comes only from the session context. */
export async function createNeed(ctx: CharityContext, input: NeedInput): Promise<string> {
  const [row] = await getDb()
    .insert(needs)
    .values({
      charityId: ctx.charityId,
      title: input.title,
      description: input.description,
      amountCents: input.amountCents,
      deadline: input.deadline,
      fundingModel: input.fundingModel,
      requiredProof: input.requiredProof,
      status: "open",
    })
    .returning({ id: needs.id });
  return row!.id;
}

export async function listCharityNeeds(ctx: CharityContext) {
  return getDb()
    .select({
      id: needs.id,
      title: needs.title,
      amountCents: needs.amountCents,
      deadline: needs.deadline,
      createdAt: needs.createdAt,
      status: needs.status,
      requiredProof: needs.requiredProof,
      heldCents,
      capturedCents,
      donorCount,
    })
    .from(needs)
    .leftJoin(donations, and(eq(donations.needId, needs.id), eq(donations.charityId, needs.charityId)))
    .where(eq(needs.charityId, ctx.charityId))
    .groupBy(needs.id)
    .orderBy(asc(needs.deadline));
}

export const PUBLIC_SORTS = ["deadline", "newest", "most_funded", "least_funded"] as const;
export type PublicSort = (typeof PUBLIC_SORTS)[number];

// Escape LIKE wildcards so a search for "100%" means the text "100%".
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Open needs for the public pages, with optional search, sort and paging. */
export async function listPublicNeeds(opts: { limit?: number; q?: string; sort?: PublicSort } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 200);
  const q = opts.q?.trim().slice(0, 80);
  const where = and(
    eq(charities.status, "active"),
    eq(needs.status, "open"),
    q ? or(ilike(needs.title, `%${escapeLike(q)}%`), ilike(charities.name, `%${escapeLike(q)}%`)) : undefined,
  );
  const funded = sql`(${heldCents})::float / nullif(${needs.amountCents}, 0)`;
  const order =
    opts.sort === "newest" ? [desc(needs.createdAt)]
    : opts.sort === "most_funded" ? [desc(funded), asc(needs.deadline)]
    : opts.sort === "least_funded" ? [asc(funded), asc(needs.deadline)]
    : [asc(needs.deadline)];

  const db = getDb();
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: needs.id,
        title: needs.title,
        amountCents: needs.amountCents,
        deadline: needs.deadline,
        status: needs.status,
        requiredProof: needs.requiredProof,
        charityName: charities.name,
        heldCents,
        donorCount,
      })
      .from(needs)
      .innerJoin(charities, eq(charities.id, needs.charityId))
      .leftJoin(donations, and(eq(donations.needId, needs.id), eq(donations.charityId, needs.charityId)))
      .where(where)
      .groupBy(needs.id, charities.name)
      .orderBy(...order)
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(needs)
      .innerJoin(charities, eq(charities.id, needs.charityId))
      .where(where),
  ]);
  return { needs: rows, total: count?.n ?? 0 };
}

/** Public view of one need. Drafts and cancelled needs are not shown. */
export async function getPublicNeed(id: string) {
  if (!UUID.test(id)) return undefined;
  const [row] = await getDb()
    .select({
      id: needs.id,
      title: needs.title,
      description: needs.description,
      amountCents: needs.amountCents,
      deadline: needs.deadline,
      status: needs.status,
      fundingModel: needs.fundingModel,
      requiredProof: needs.requiredProof,
      createdAt: needs.createdAt,
      charityName: charities.name,
      heldCents,
      capturedCents,
      donorCount,
    })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .leftJoin(donations, and(eq(donations.needId, needs.id), eq(donations.charityId, needs.charityId)))
    .where(and(eq(needs.id, id), eq(charities.status, "active"), inArray(needs.status, [...PUBLIC_STATUSES])))
    .groupBy(needs.id, charities.name)
    .limit(1);
  return row;
}
