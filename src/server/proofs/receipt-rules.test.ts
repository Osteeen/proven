import { describe, expect, it } from "vitest";
import { assessReceipt, receiptKeys, type ReceiptReading } from "./receipt-rules";

const now = new Date("2026-10-14T12:00:00Z");
const need = { amountCents: 50000, createdAt: new Date("2026-10-10T09:00:00Z"), deadline: new Date("2026-10-20T23:59:59Z") };
const clean = { otherNeed: false, how: null } as const;
const good: ReceiptReading = {
  is_receipt: true,
  merchant_name: "Valley Supply Co.",
  receipt_number: "INV-2291",
  purchase_date: "2026-10-13",
  currency: "USD",
  line_items: [{ description: "Wool blanket", quantity: 50, unit_price_cents: 980, line_total_cents: 49000 }],
  total_cents: 49000,
  matches_need: "yes",
  match_reason: "50 wool blankets, as the need describes.",
  edit_signs: [],
  concerns: [],
  confidence: "high",
};

describe("assessReceipt", () => {
  it("passes a clean receipt that matches the need and records the spend, labelling the AI's words", () => {
    expect(assessReceipt(good, need, clean, now)).toEqual({ status: "passed", reasons: [`AI read: ${good.match_reason}`], amountCents: 49000 });
  });
  it("fails anything that isn't a receipt, or doesn't match the need", () => {
    expect(assessReceipt({ ...good, is_receipt: false }, need, clean, now).status).toBe("failed");
    expect(assessReceipt({ ...good, matches_need: "no", match_reason: "groceries, not blankets" }, need, clean, now).reasons[0]).toMatch(/groceries/);
  });
  it("sends a receipt also used on another need to a person - never decided by who uploaded first", () => {
    expect(assessReceipt(good, need, { otherNeed: true, how: "image" }, now).status).toBe("needs_review");
    expect(assessReceipt(good, need, { otherNeed: true, how: "details" }, now).reasons[0]).toMatch(/same details/);
  });
  it("never passes a receipt it couldn't recognise again", () => {
    const review = (r: Partial<ReceiptReading>) => assessReceipt({ ...good, ...r }, need, clean, now).status;
    expect(review({ merchant_name: null })).toBe("needs_review"); // shop cropped off
    expect(review({ receipt_number: null, purchase_date: null })).toBe("needs_review");
    expect(review({ total_cents: null })).toBe("needs_review");
  });
  it("requires US dollars to be shown", () => {
    expect(assessReceipt({ ...good, currency: null }, need, clean, now).status).toBe("needs_review");
    expect(assessReceipt({ ...good, currency: "NGN" }, need, clean, now).status).toBe("needs_review");
  });
  it("sends other borderline receipts to a person", () => {
    const review = (r: Partial<ReceiptReading>) => assessReceipt({ ...good, ...r }, need, clean, now).status;
    expect(review({ total_cents: 60000, line_items: [] })).toBe("needs_review"); // more than the need
    expect(review({ edit_signs: ["total digits misaligned"] })).toBe("needs_review");
    expect(review({ matches_need: "partly" })).toBe("needs_review");
    expect(review({ confidence: "low" })).toBe("needs_review");
    expect(review({ purchase_date: "2026-09-01" })).toBe("needs_review"); // long before the need
    expect(review({ purchase_date: "2026-10-30" })).toBe("needs_review"); // future
    expect(review({ line_items: [{ description: "x", quantity: 1, unit_price_cents: 100, line_total_cents: 100 }] })).toBe("needs_review"); // lines don't add up
  });
  it("allows tax between the line items and the total", () => {
    // $490.00 of items + 7% tax = $524.30 on a $600 need.
    expect(assessReceipt({ ...good, total_cents: 52430 }, { ...need, amountCents: 60000 }, clean, now).status).toBe("passed");
  });
  it("labels and shortens the AI's words so they can't pass for Proven's own", () => {
    const r = assessReceipt({ ...good, matches_need: "partly", match_reason: "x".repeat(1000) }, need, clean, now);
    expect(r.reasons.join(" ")).toMatch(/AI read: x+\.\.\./);
    expect(r.reasons.join(" ").length).toBeLessThan(400);
  });
});

describe("receiptKeys", () => {
  it("gives several keys so one cropped detail can't hide a duplicate", () => {
    expect(receiptKeys(good)).toEqual(["num:inv2291|49000", "date:2026-10-13|49000", "shop:valleysupply|2026-10-13|49000"]);
  });
  it("matches a crop without the receipt number on date and shop", () => {
    const cropped = receiptKeys({ ...good, receipt_number: null });
    expect(cropped.some((k) => receiptKeys(good).includes(k))).toBe(true);
  });
  it("matches a crop without the shop name on number and date", () => {
    const cropped = receiptKeys({ ...good, merchant_name: null });
    expect(cropped.some((k) => receiptKeys(good).includes(k))).toBe(true);
  });
  it("evens out how the AI writes the shop and number", () => {
    expect(receiptKeys({ ...good, merchant_name: "VALLEY SUPPLY COMPANY", receipt_number: "INV-229l".replace("l", "1") })).toContain("shop:valleysupply|2026-10-13|49000");
    expect(receiptKeys({ ...good, receipt_number: "INV-22O1" })[0]).toBe(receiptKeys({ ...good, receipt_number: "INV-2201" })[0]);
  });
  it("gives no keys without a total", () => {
    expect(receiptKeys({ ...good, total_cents: null })).toEqual([]);
  });
});
