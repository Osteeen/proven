import { describe, expect, it } from "vitest";
import { maskEmail } from "@/server/mail/mailer";
import { giftAddedEmail, giftHeldEmail } from "./emails";

const facts = {
  to: "donor@personal.example.com",
  donationId: "00000000-0000-0000-0000-000000000001",
  link: "http://127.0.0.1:3000/d/abc",
  amountCents: 10000,
  totalCents: 12500,
  needTitle: "50 blankets",
  charityName: "Riverbend Relief",
  deadline: new Date("2026-10-20T23:59:59Z"),
  holdExpiresAt: new Date("2026-11-07T00:00:00Z"),
};

describe("gift emails", () => {
  it("first gift: says held, not charged, and carries the private link", () => {
    const m = giftHeldEmail(facts);
    expect(m.kind).toBe("gift_held");
    expect(m.subject).toBe("PayPal is holding your $100.00 for 50 blankets - you haven't paid");
    expect(m.text).toContain(facts.link);
    expect(m.text).toContain("October 20");
    expect(m.text).toContain("November 7");
  });

  it("top-up: shows the added amount and the new total", () => {
    const m = giftAddedEmail({ ...facts, amountCents: 2500 });
    expect(m.kind).toBe("gift_added");
    expect(m.subject).toBe("You added $25.00 - PayPal now holds $125.00 for 50 blankets");
    expect(m.text).toContain(facts.link);
  });

  it("uses plain hyphens, never em or en dashes", () => {
    for (const m of [giftHeldEmail(facts), giftAddedEmail(facts)]) {
      expect(m.subject + m.text).not.toMatch(/[–—]/);
    }
  });
});

describe("maskEmail", () => {
  it.each([
    ["donor@personal.example.com", "d***@personal.example.com"],
    ["a@b.c", "a***@b.c"],
    ["not-an-email", "your PayPal email"],
  ])("masks %s", (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});
