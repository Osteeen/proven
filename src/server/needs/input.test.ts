import { describe, expect, it } from "vitest";
import { parseNeedInput } from "./input";

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
    [{ requiredProof: ["receipt"] }, "requiredProof"],
    [{ requiredProof: ["receipt", "made_up"] }, "requiredProof"],
    [{ fundingModel: "everything_now" }, "fundingModel"],
    [{ title: "x" }, "title"],
    [{ description: "short" }, "description"],
  ])("rejects %j", (patch, field) => {
    const r = parseNeedInput({ ...good, ...patch }, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty(field);
  });

  it("requires at least one independent proof", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["receipt", "live_photo"] }, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.requiredProof).toMatch(/independent/);
  });

  it.each([["supplier_confirmation"], ["supplier_paypal_payment"], ["recipient_confirmation"]])("accepts own evidence plus %s", (independent) => {
    expect(parseNeedInput({ ...good, requiredProof: ["receipt", independent] }, opts).ok).toBe(true);
  });

  it("drops duplicate proof types", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["receipt", "receipt", "supplier_confirmation"] }, opts);
    expect(r.ok && r.value.requiredProof).toEqual(["receipt", "supplier_confirmation"]);
  });

  it("does not count duplicates toward the two-proof minimum", () => {
    const r = parseNeedInput({ ...good, requiredProof: ["receipt", "receipt"] }, opts);
    expect(r.ok).toBe(false);
  });
});
