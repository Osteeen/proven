import "server-only";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { charities, memberships, users } from "@/server/db/schema";

export type CharityContext = { userId: string; charityId: string; charityName: string; isDemo: boolean };
export type ReviewerContext = { userId: string; isDemo: boolean };

async function sessionUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/signin");
  return id;
}

/**
 * The only way charity pages and actions learn which charity they act for:
 * from the server-side session and the memberships table, never from the request.
 */
export async function requireCharity(): Promise<CharityContext> {
  const userId = await sessionUserId();
  const rows = await getDb()
    .select({ charityId: charities.id, charityName: charities.name, isDemo: users.isDemo })
    .from(memberships)
    .innerJoin(charities, eq(charities.id, memberships.charityId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "charity_admin")));
  // One charity per user for the hackathon; anything else is refused rather than guessed.
  if (rows.length !== 1) notFound();
  const row = rows[0]!;
  return { userId, charityId: row.charityId, charityName: row.charityName, isDemo: row.isDemo };
}

export async function requireReviewer(): Promise<ReviewerContext> {
  const userId = await sessionUserId();
  const [row] = await getDb()
    .select({ role: users.role, isDemo: users.isDemo })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.role !== "reviewer") notFound();
  return { userId, isDemo: row.isDemo };
}

/**
 * Charities a reviewer may act on. A real reviewer: every charity (null = no
 * limit). A demo reviewer (anyone can sign in as one when DEMO_LOGIN is on):
 * only charities the seed marked is_demo - so a visitor can never approve,
 * refund or close a real charity's money.
 */
export async function reviewerCharityScope(reviewer: ReviewerContext): Promise<string[] | null> {
  if (!reviewer.isDemo) return null;
  const rows = await getDb().select({ id: charities.id }).from(charities).where(eq(charities.isDemo, true));
  return rows.map((r) => r.id);
}

/** Refuses (as "not found") when this reviewer may not act on this charity. */
export async function reviewerMayActOn(reviewer: ReviewerContext, charityId: string): Promise<boolean> {
  const scope = await reviewerCharityScope(reviewer);
  return scope === null || scope.includes(charityId);
}
