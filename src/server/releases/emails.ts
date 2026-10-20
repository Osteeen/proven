import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { charities, donations, needs, refunds } from "@/server/db/schema";
import { sendMail } from "@/server/mail/mailer";
import { formatUsd } from "@/server/money";
import { impactFacts } from "@/server/impact";

const SETTLED = ["captured", "voided", "partially_captured", "authorized"] as const;

/**
 * After a need settles, one email per donor (per private gift link): what they
 * were charged and what was never charged. Proven only keeps a hash of each
 * gift link, so these emails point back to the first email rather than
 * repeating the link. Never throws - a failed email is logged.
 */
export async function emailDonorsAfterSettlement(needId: string, outcome: "proven" | "released"): Promise<void> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        hash: donations.donorAccessHash,
        email: donations.donorEmail,
        amountCents: donations.amountCents,
        capturedCents: donations.capturedCents,
        id: donations.id,
        needTitle: needs.title,
        charityName: charities.name,
      })
      .from(donations)
      .innerJoin(needs, and(eq(needs.id, donations.needId), eq(needs.charityId, donations.charityId)))
      .innerJoin(charities, eq(charities.id, donations.charityId))
      .where(and(eq(donations.needId, needId), inArray(donations.status, [...SETTLED]), isNotNull(donations.donorEmail)));

    // The impact receipt: the same verified facts for every donor to this need.
    const impact = outcome === "proven" ? await impactFacts(needId).catch(() => []) : [];
    const byGift = new Map<string, typeof rows>();
    for (const r of rows) byGift.set(r.hash, [...(byGift.get(r.hash) ?? []), r]);

    for (const gift of byGift.values()) {
      const first = gift[0]!;
      const total = gift.reduce((s, r) => s + r.amountCents, 0);
      const charged = gift.reduce((s, r) => s + r.capturedCents, 0);
      const never = total - charged;
      const proven = outcome === "proven";
      const subject = proven
        ? `Delivery proven - you paid ${formatUsd(charged)} for ${first.needTitle}`
        : charged > 0
          ? `${first.needTitle} was closed - ${formatUsd(never)} goes back to you`
          : `${first.needTitle} wasn't proven - you never paid`;
      const lines = proven
        ? [
            `${first.charityName} delivered "${first.needTitle}" and it checked out.`,
            "",
            `Charged: ${formatUsd(charged)} of your ${formatUsd(total)} - only what was actually spent.`,
            never > 0 ? `Not charged: ${formatUsd(never)}. It goes back to you through PayPal.` : "Your whole donation was used.",
            ...(impact.length ? ["", "What your donation did - and how we know:", ...impact.map((f) => `- ${f}`)] : []),
          ]
        : [
            `"${first.needTitle}" from ${first.charityName} was closed without proof of delivery.`,
            "",
            charged > 0
              ? `You paid ${formatUsd(charged)} earlier for the booking. The other ${formatUsd(never)} was never taken - it goes back to you through PayPal.`
              : `You never paid. Your ${formatUsd(total)} goes back to you through PayPal.`,
          ];
      await sendMail({
        kind: proven ? "gift_proven" : "gift_released",
        to: first.email!,
        donationId: first.id,
        subject,
        text: [...lines, "", "Track your donation with the link in our first email - it shows the details.", "", "- Proven (PayPal sandbox demo - no real money moves)"].join("\n"),
      });
    }
  } catch (e) {
    console.error("Settlement emails failed", { needId, error: e instanceof Error ? e.message : e });
  }
}

/**
 * After a refund completes: one email per donor (per gift link) saying how much
 * came back and what they were charged in the end. Never throws.
 */
export async function emailDonorsAboutRefund(refundIds: string[]): Promise<void> {
  try {
    const rows = await getDb()
      .select({
        hash: donations.donorAccessHash,
        email: donations.donorEmail,
        donationId: donations.id,
        refundCents: refunds.amountCents,
        capturedCents: donations.capturedCents,
        refundedCents: donations.refundedCents,
        reason: refunds.reason,
        needTitle: needs.title,
        charityName: charities.name,
      })
      .from(refunds)
      .innerJoin(donations, and(eq(donations.id, refunds.donationId), eq(donations.charityId, refunds.charityId)))
      .innerJoin(needs, and(eq(needs.id, refunds.needId), eq(needs.charityId, refunds.charityId)))
      .innerJoin(charities, eq(charities.id, refunds.charityId))
      .where(and(inArray(refunds.id, refundIds), eq(refunds.status, "completed"), isNotNull(donations.donorEmail)));

    const byGift = new Map<string, typeof rows>();
    for (const r of rows) byGift.set(`${r.hash}|${r.reason}`, [...(byGift.get(`${r.hash}|${r.reason}`) ?? []), r]);
    for (const gift of byGift.values()) {
      const first = gift[0]!;
      const back = gift.reduce((s, r) => s + r.refundCents, 0);
      // Per donation totals, counted once each even if a donation had several refunded charges.
      const seen = new Map(gift.map((r) => [r.donationId, r]));
      const net = [...seen.values()].reduce((s, r) => s + r.capturedCents - r.refundedCents, 0);
      await sendMail({
        kind: "gift_refunded",
        to: first.email!,
        donationId: first.donationId,
        subject: `${formatUsd(back)} refunded to you for ${first.needTitle}`,
        text: [
          `Proven has refunded ${formatUsd(back)} of what you were charged for "${first.needTitle}" from ${first.charityName}.`,
          "",
          `Why: ${first.reason}`,
          "",
          net > 0 ? `You were charged ${formatUsd(net)} in the end.` : "You were not charged anything in the end.",
          "PayPal sends the money back to the account or card you used to pay.",
          "",
          "Track your donation with the link in our first email - it shows the details.",
          "",
          "- Proven (PayPal sandbox demo - no real money moves)",
        ].join("\n"),
      });
    }
  } catch (e) {
    console.error("Refund emails failed", { refunds: refundIds.length, error: e instanceof Error ? e.message : e });
  }
}
