import { describe, expect, it } from "vitest";
import { median, priceVerdict } from "./price-rules";

describe("market price verdict", () => {
  const market = [400, 450, 500, 520, 600]; // median $5.00, 5 listings
  it("finds the median", () => {
    expect(median(market)).toBe(500);
    expect(median([100, 300])).toBe(200);
    expect(median([])).toBeNull();
  });
  it.each([
    [500, "in_line"],
    [620, "in_line"],
    [700, "above"],
    [900, "well_above"],
    [250, "below"],
  ])("a unit price of %i cents is %s", (unit, verdict) => {
    expect(priceVerdict(unit, market).verdict).toBe(verdict);
  });
  it("gives no verdict with fewer than 5 comparable listings", () => {
    expect(priceVerdict(900, [500, 500, 520, 480]).verdict).toBe("unknown");
  });
  it("ignores nonsense prices", () => {
    expect(priceVerdict(500, [0, -5, 500, 510, 490, 505, 495]).verdict).toBe("in_line");
    expect(priceVerdict(500, [0, -5, 500, 510, 490]).verdict).toBe("unknown");
  });
});
