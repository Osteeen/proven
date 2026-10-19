import { describe, expect, it } from "vitest";
import { advanceCapCents, allocate, finalReleaseBlock, finalReleaseRoomCents, proofChecked, reviewReason } from "./rules";

const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);

describe("allocate", () => {
  it("charges every donor the same share when less than the hold is spent", () => {
    const r = allocate(46000, [
      { donationId: "a", availableCents: 10000 },
      { donationId: "b", availableCents: 40000 },
    ]);
    expect(r).toEqual([
      { donationId: "a", cents: 9200 },
      { donationId: "b", cents: 36800 },
    ]);
  });

  it("always adds up to exactly the total, cent for cent", () => {
    const holds = [
      { donationId: "a", availableCents: 333 },
      { donationId: "b", availableCents: 333 },
      { donationId: "c", availableCents: 334 },
    ];
    for (const total of [0, 1, 2, 3, 100, 499, 500, 999, 1000]) {
      const r = allocate(total, holds);
      expect(sum(r)).toBe(total);
      r.forEach((s, i) => expect(s.cents).toBeLessThanOrEqual(holds[i]!.availableCents));
    }
  });

  it("stays exact for very large needs", () => {
    const holds = [
      { donationId: "a", availableCents: 70_000_001 },
      { donationId: "b", availableCents: 29_999_999 },
    ];
    const r = allocate(99_999_999, holds);
    expect(sum(r)).toBe(99_999_999);
  });

  it("takes everything when the full amount is spent", () => {
    expect(allocate(12500, [{ donationId: "a", availableCents: 10000 }, { donationId: "b", availableCents: 2500 }])).toEqual([
      { donationId: "a", cents: 10000 },
      { donationId: "b", cents: 2500 },
    ]);
  });

  it("gives rounding cents to earlier holds on a tie", () => {
    expect(allocate(1, [{ donationId: "a", availableCents: 1 }, { donationId: "b", availableCents: 1 }])).toEqual([
      { donationId: "a", cents: 1 },
      { donationId: "b", cents: 0 },
    ]);
  });

  it("refuses to release more than is held, or nonsense amounts", () => {
    expect(() => allocate(2, [{ donationId: "a", availableCents: 1 }])).toThrow();
    expect(() => allocate(-1, [{ donationId: "a", availableCents: 1 }])).toThrow();
    expect(() => allocate(1.5, [{ donationId: "a", availableCents: 5 }])).toThrow();
  });
});

describe("advanceCapCents", () => {
  it("lets new charities take 25% up front, others 50%", () => {
    expect(advanceCapCents(50000, "new")).toBe(12500);
    expect(advanceCapCents(50000, "established")).toBe(25000);
    expect(advanceCapCents(333, "new")).toBe(83);
  });
});

describe("reviewReason", () => {
  const base = { kind: "advance" as const, trustTier: "established" as const, completedReleases: 3, amountCents: 50000, thresholdCents: 100000 };
  it("sends a new charity's first release to a person", () => {
    expect(reviewReason({ ...base, trustTier: "new", completedReleases: 0 })).toMatch(/First release/);
  });
  it("sends large releases to a person", () => {
    expect(reviewReason({ ...base, amountCents: 100001 })).toMatch(/threshold/);
  });
  it("sends a delivery release to a person unless its proof was checked", () => {
    expect(reviewReason({ ...base, kind: "final" })).toMatch(/checked by a person/);
    expect(reviewReason({ ...base, kind: "final", proofChecked: true })).toBeNull();
    // Checked proof never skips the other reasons.
    expect(reviewReason({ ...base, kind: "final", proofChecked: true, amountCents: 100001 })).toMatch(/threshold/);
  });
  it("sends a need priced well above market to a person", () => {
    expect(reviewReason({ ...base, kind: "final", proofChecked: true, priceWellAboveMarket: true })).toMatch(/above market/);
  });
  it("sends booking payments on needs bought through Proven to a person", () => {
    expect(reviewReason({ ...base, requiresSupplierPayment: true })).toMatch(/Booking payment/);
  });
  it("lets routine advances through", () => {
    expect(reviewReason(base)).toBeNull();
    expect(reviewReason({ ...base, trustTier: "new", completedReleases: 1 })).toBeNull();
    expect(reviewReason({ ...base, amountCents: 100000 })).toBeNull();
  });
});

describe("finalReleaseBlock", () => {
  const ok = {
    requiresSupplierPayment: true,
    supplierPaidCents: 20000,
    passedKinds: ["supplier_paypal_payment", "receipt"],
    releasedCents: 0,
    requiredSecondChecks: ["receipt"],
    openIssues: 0,
  };
  it("needs a PayPal supplier payment first", () => {
    expect(finalReleaseBlock({ ...ok, supplierPaidCents: 0 }, 100)).toMatch(/Pay the supplier/);
  });
  it("needs a second check", () => {
    expect(finalReleaseBlock({ ...ok, passedKinds: ["supplier_paypal_payment"] }, 100)).toMatch(/second check/);
    // A promised check waiting for a person opens the release - and it can never skip review.
    const inReview = { ...ok, passedKinds: ["supplier_paypal_payment"], reviewKinds: ["receipt"], requiredSecondChecks: ["receipt"], openIssues: 1 };
    expect(finalReleaseBlock(inReview, 100)).toBeNull();
    expect(proofChecked(inReview)).toBe(false);
    // ...but only a check this need promised, and never one that failed (failed kinds are in neither list).
    expect(finalReleaseBlock({ ...inReview, reviewKinds: ["recipient_confirmation"] }, 100)).toMatch(/second check/);
    expect(finalReleaseBlock({ ...inReview, reviewKinds: [] }, 100)).toMatch(/second check/);
  });
  it("never releases more than was paid to suppliers, counting earlier releases", () => {
    expect(finalReleaseBlock(ok, 20000)).toBeNull();
    expect(finalReleaseBlock(ok, 20001)).toMatch(/up to \$200\.00/);
    expect(finalReleaseBlock({ ...ok, releasedCents: 5000 }, 15001)).toMatch(/up to \$150\.00/);
    expect(finalReleaseRoomCents({ ...ok, releasedCents: 25000 })).toBe(0);
  });
  it("leaves needs posted before the rule to a person", () => {
    const legacy = { ...ok, requiresSupplierPayment: false, supplierPaidCents: 0, passedKinds: [] };
    expect(finalReleaseBlock(legacy, 100)).toBeNull();
    expect(proofChecked(legacy)).toBe(false);
  });
  it("counts proof as checked only when both parts pass", () => {
    expect(proofChecked(ok)).toBe(true);
    expect(proofChecked({ ...ok, passedKinds: ["supplier_paypal_payment"] })).toBe(false);
  });
  it("never skips review on the supplier's own word alone", () => {
    const p = { ...ok, passedKinds: ["supplier_paypal_payment", "supplier_confirmation"], requiredSecondChecks: ["supplier_confirmation"] };
    expect(finalReleaseBlock(p, 100)).toBeNull(); // it may still be released - by a person
    expect(proofChecked(p)).toBe(false);
    expect(proofChecked({ ...p, passedKinds: [...p.passedKinds, "receipt"], requiredSecondChecks: ["supplier_confirmation", "receipt"] })).toBe(true);
  });
  it("only counts second checks the need asked for", () => {
    const p = { ...ok, passedKinds: ["supplier_paypal_payment", "supplier_confirmation"], requiredSecondChecks: ["recipient_confirmation"] };
    expect(finalReleaseBlock(p, 100)).toMatch(/second check/);
    expect(proofChecked(p)).toBe(false);
  });
  it("sends the release to a person when any proof is in doubt, even if others passed", () => {
    // A recipient said no (needs_review) while a receipt passed.
    const p = { ...ok, requiredSecondChecks: ["receipt", "recipient_confirmation"], openIssues: 1 };
    expect(finalReleaseBlock(p, 100)).toBeNull();
    expect(proofChecked(p)).toBe(false);
  });
  it("needs every promised check to pass before skipping review", () => {
    const p = { ...ok, requiredSecondChecks: ["receipt", "recipient_confirmation"] };
    expect(proofChecked(p)).toBe(false);
    expect(proofChecked({ ...p, passedKinds: [...p.passedKinds, "recipient_confirmation"] })).toBe(true);
  });
});
