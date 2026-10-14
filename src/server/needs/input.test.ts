import { describe, expect, it } from "vitest";
import { deadlineBounds, parseNeedInput } from "./input";

const now = new Date("2026-10-09T12:00:00Z");
const opts = { now };
const good = {
  title: "50 blankets for Riverbend shelter",
  description: "Wool blankets for the 50 families sleeping at the school gym.",
  amount: "500",
  deadline: "2026-10-20",
  fundingModel: "reimbursement",
  requiredProof: ["receipt", "supplier_confirmation"],
};

describe("parseNeedInput", () => {
  it("accepts a valid need and converts money to cents", () => {
    const r = parseNeedInput(good, opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.amountCents).toBe(50_000);
      expect(r.value.deadline.toISOString()).toBe("2026-10-20T23:59:59.000Z");
    }
  });

  it.each(["$499.50", "1,000", "25000", "999999.99"])("accepts amount %s - posting has no per-charity cap", (amount) => {
    expect(parseNeedInput({ ...good, amount }, opts).ok).toBe(true);
  });

  it.each([
    [{ amount: "-5" }, "amount"],
    [{ amount: "0.50" }, "amount"],
    [{ amount: "12.345" }, "amount"],
    [{ amount: "1000000.01" }, "amount"],
    [{ deadline: "2026-10-09" }, "deadline"],
    [{ deadline: "2026-11-07" }, "deadline"],
    [{ deadline: "soon" }, "deadline"],
    [{ requiredProof: [] }, "requiredProof"],
    [{ requiredProof: ["supplier_paypal_payment"] }, "requiredProof"],
    [{ requiredProof: ["receipt", "made_up"] }, "requiredProof"],
    [{ fundingModel: "everything_now" }, "fundingModel"],
    [{ title: "x" }, "title"],
    [{ description: "short" }, "description"],
  ])("rejects %j", (patch, field) => {
    const r = parseNeedInput({ ...good, ...patch }, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty(field);
  });

  it("always requires the PayPal supplier payment, first", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["receipt"] }, opts);
    expect(r.ok && r.value.requiredProof).toEqual(["supplier_paypal_payment", "receipt"]);
  });

  it("needs a second check next to it", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["supplier_paypal_payment"] }, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.requiredProof).toMatch(/second check/);
  });

  it("doesn't offer live photo yet - nothing could check it", () => {
    expect(parseNeedInput({ ...good, requiredProof: ["live_photo"] }, opts).ok).toBe(false);
  });

  it.each([["receipt"], ["supplier_confirmation"], ["recipient_confirmation"]])("accepts %s as the second check", (second) => {
    expect(parseNeedInput({ ...good, requiredProof: [second] }, opts).ok).toBe(true);
  });

  it("drops duplicate proof types", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["receipt", "receipt", "supplier_paypal_payment", "supplier_confirmation"] }, opts);
    expect(r.ok && r.value.requiredProof).toEqual(["supplier_paypal_payment", "receipt", "supplier_confirmation"]);
  });
});

describe("deadline of tomorrow", () => {
  it("is the earliest date the calendar offers", () => {
    expect(deadlineBounds(Date.parse("2026-10-12T20:55:00Z")).min).toBe("2026-10-13");
  });
  it("is accepted even one second before midnight UTC", () => {
    const late = { now: new Date("2026-10-12T23:59:59Z") };
    expect(parseNeedInput({ ...good, deadline: "2026-10-13" }, late).ok).toBe(true);
  });
  it("still refuses today", () => {
    expect(parseNeedInput({ ...good, deadline: "2026-10-12" }, { now: new Date("2026-10-12T08:00:00Z") }).ok).toBe(false);
  });
});
