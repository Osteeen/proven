import { formatUsd } from "@/server/money";
import type { Mail } from "@/server/mail/mailer";

type GiftFacts = {
  to: string;
  donationId: string;
  link: string;
  amountCents: number;
  totalCents: number;
  needTitle: string;
  charityName: string;
  deadline: Date;
  holdExpiresAt?: Date;
};

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** The first email: the hold is placed, nothing is charged, here is your link. */
export function giftHeldEmail(f: GiftFacts): Mail {
  return {
    kind: "gift_held",
    to: f.to,
    donationId: f.donationId,
    subject: `PayPal is holding your ${formatUsd(f.amountCents)} for ${f.needTitle} - you haven't paid`,
    text: [
      `Thank you. PayPal is holding ${formatUsd(f.amountCents)} for "${f.needTitle}" from ${f.charityName}.`,
      "",
      "You haven't been charged. Here's what happens next:",
      `- ${f.charityName} has until ${day(f.deadline)} to deliver and prove it.`,
      "- If at least two independent checks agree, you pay only what was actually spent.",
      `- If it isn't proven in time, the hold is cancelled and you're never charged.${f.holdExpiresAt ? ` The hold lasts until ${day(f.holdExpiresAt)} at the latest.` : ""}`,
      "",
      "Track your donation here - only you have this link:",
      f.link,
      "",
      "We'll email you when delivery is proven or your money goes back to you without charge.",
      "",
      "- Proven (PayPal sandbox demo - no real money moves)",
    ].join("\n"),
  };
}

/** A top-up: same gift page, new total. */
export function giftAddedEmail(f: GiftFacts): Mail {
  return {
    kind: "gift_added",
    to: f.to,
    donationId: f.donationId,
    subject: `You added ${formatUsd(f.amountCents)} - PayPal now holds ${formatUsd(f.totalCents)} for ${f.needTitle}`,
    text: [
      `PayPal is now holding ${formatUsd(f.amountCents)} more for "${f.needTitle}" from ${f.charityName}.`,
      `Your donation is ${formatUsd(f.totalCents)} in total. You still haven't been charged.`,
      "",
      "Same private link as before:",
      f.link,
      "",
      "- Proven (PayPal sandbox demo - no real money moves)",
    ].join("\n"),
  };
}
