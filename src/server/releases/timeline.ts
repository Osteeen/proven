import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities, donations, needs } from "@/server/db/schema";

export type TimelineNeed = { id: string; title: string; charity: string; deadline: string; status: string };
export type TimelineHold = {
  id: string;
  needId: string;
  amountCents: number;
  capturedCents: number;
  status: string;
  start: string;
  end: string;
  renewedUntil: string | null;
};

const LIVE_NEEDS = ["open", "funded", "delivering", "in_review"] as const;
const DAY = 86_400_000;

/**
 * For the Bryntum timeline: live needs and every donor hold on them, from the
 * moment PayPal placed it to when it lapses (29 days). `charityIds` limits it -
 * to one charity for its own dashboard, or a demo reviewer's scope.
 * Donors stay anonymous: a hold is an amount and dates, nothing else.
 */
export async function timelineData(charityIds: string[] | null): Promise<{ needs: TimelineNeed[]; holds: TimelineHold[] }> {
  if (charityIds !== null && charityIds.length === 0) return { needs: [], holds: [] };
  const db = getDb();
  const ns = await db
    .select({ id: needs.id, title: needs.title, charity: charities.name, deadline: needs.deadline, status: needs.status })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(and(eq(charities.status, "active"), inArray(needs.status, [...LIVE_NEEDS]), charityIds === null ? undefined : inArray(needs.charityId, charityIds)))
    .orderBy(asc(needs.deadline))
    .limit(200);
  if (ns.length === 0) return { needs: [], holds: [] };
  const hs = await db
    .select({
      id: donations.id,
      needId: donations.needId,
      amountCents: donations.amountCents,
      capturedCents: donations.capturedCents,
      status: donations.status,
      authorizedAt: donations.authorizedAt,
      holdExpiresAt: donations.holdExpiresAt,
      honorPeriodEndsAt: donations.honorPeriodEndsAt,
      reauthorizeCount: donations.reauthorizeCount,
    })
    .from(donations)
    .where(and(inArray(donations.needId, ns.map((n) => n.id)), inArray(donations.status, ["authorized", "partially_captured"])));
  return {
    needs: ns.map((n) => ({ ...n, deadline: n.deadline.toISOString() })),
    holds: hs
      .filter((h) => h.authorizedAt)
      .map((h) => ({
        id: h.id,
        needId: h.needId,
        amountCents: h.amountCents,
        capturedCents: h.capturedCents,
        status: h.status,
        start: h.authorizedAt!.toISOString(),
        // PayPal's own expiry when we have it; otherwise the 29-day rule.
        end: (h.holdExpiresAt ?? new Date(h.authorizedAt!.getTime() + 29 * DAY)).toISOString(),
        renewedUntil: h.reauthorizeCount > 0 && h.honorPeriodEndsAt ? h.honorPeriodEndsAt.toISOString() : null,
      })),
  };
}
