import "server-only";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { charities, memberships, users } from "@/server/db/schema";
import { reviewerMayActOn } from "./scope";
export { reviewerCharityScope, reviewerMayActOn } from "./scope";

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
 * May the signed-in user see this charity's private files (receipts)? Its own
 * members can; reviewers can within their scope. Everyone else (including
 * donors and other charities) cannot. Returns false rather than redirecting,
 * for API routes.
 */
export async function maySeeCharityFiles(charityId: string): Promise<boolean> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return false;
  const db = getDb();
  const [member] = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.charityId, charityId)))
    .limit(1);
  if (member) return true;
  const [u] = await db.select({ role: users.role, isDemo: users.isDemo }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.role !== "reviewer") return false;
  return reviewerMayActOn({ userId, isDemo: u.isDemo }, charityId);
}
