import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { ReviewerContext } from "@/server/auth/access";
import { reviewerCharityScope } from "@/server/auth/scope";
import { getDb } from "@/server/db/client";
import { charities, donations, ledgerEntries, needs } from "@/server/db/schema";

export type LedgerRow = {
  id: string;
  at: string;
  charity: string;
  need: string;
  donation: string;
  event: string;
  amountCents: number;
  paypalReference: string | null;
  actor: string;
};

const MAX_ROWS = 5000;

/**
 * The money ledger for reviewers, newest first: every hold, renewal, charge,
 * release and refund, one row each. A demo reviewer sees demo charities only.
 * Donors stay anonymous: a donation shows as a short reference, never a name or email.
 */
export async function listLedger(reviewer: ReviewerContext): Promise<LedgerRow[]> {
  const scope = await reviewerCharityScope(reviewer);
  if (scope !== null && scope.length === 0) return [];
  const rows = await getDb()
    .select({
      id: ledgerEntries.id,
      at: ledgerEntries.createdAt,
      charity: charities.name,
      need: needs.title,
      donationId: ledgerEntries.donationId,
      event: ledgerEntries.event,
      amountCents: ledgerEntries.amountCents,
      paypalReference: ledgerEntries.paypalReference,
      actor: ledgerEntries.actorType,
    })
    .from(ledgerEntries)
    .innerJoin(charities, eq(charities.id, ledgerEntries.charityId))
    .leftJoin(donations, eq(donations.id, ledgerEntries.donationId))
    .leftJoin(needs, eq(needs.id, donations.needId))
    .where(scope === null ? undefined : inArray(ledgerEntries.charityId, scope))
    .orderBy(desc(ledgerEntries.createdAt), desc(sql`${ledgerEntries.id}`))
    .limit(MAX_ROWS);
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    charity: r.charity,
    need: r.need ?? "-",
    donation: r.donationId ? `Donation ${r.donationId.slice(0, 6)}` : "-",
    event: r.event,
    amountCents: r.amountCents,
    paypalReference: r.paypalReference,
    actor: r.actor,
  }));
}
