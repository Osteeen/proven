import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities } from "@/server/db/schema";
import type { ReviewerContext } from "./access";

// Database-only scope rules for reviewers, kept apart from the session code so
// services (and their tests) can use them without loading Auth.js.

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

