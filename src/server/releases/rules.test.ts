import { describe, expect, it } from "vitest";
import { advanceCapCents, allocate, reviewReason } from "./rules";

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
  it("sends every delivery release to a person until proof checks are automated", () => {
    expect(reviewReason({ ...base, kind: "final" })).toMatch(/checked by a person/);
  });
  it("lets routine advances through", () => {
    expect(reviewReason(base)).toBeNull();
    expect(reviewReason({ ...base, trustTier: "new", completedReleases: 1 })).toBeNull();
    expect(reviewReason({ ...base, amountCents: 100000 })).toBeNull();
  });
});
