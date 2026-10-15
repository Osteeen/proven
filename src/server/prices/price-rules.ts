// Pure rules for the market-price check. No AI, no network - unit-tested.

export type PriceVerdict = "in_line" | "above" | "well_above" | "below" | "unknown";

/**
 * Fewer comparable listings than this and there's no verdict. Shopping catalogues
 * carry few bulk relief goods, so a thin match (3 feminine-hygiene packs for a
 * full hygiene kit) must not judge a price.
 */
export const MIN_COMPARABLES = 5;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * The need's unit price against the market median. Generous bands: relief buys
 * fast, locally and in bulk, so only a clear gap is flagged.
 */
export function priceVerdict(unitCents: number, comparableUnitCents: number[]): { verdict: PriceVerdict; medianCents: number | null } {
  const clean = comparableUnitCents.filter((c) => Number.isSafeInteger(c) && c > 0);
  const med = median(clean);
  if (!med || clean.length < MIN_COMPARABLES || unitCents <= 0) return { verdict: "unknown", medianCents: med };
  const ratio = unitCents / med;
  if (ratio > 1.6) return { verdict: "well_above", medianCents: med };
  if (ratio > 1.25) return { verdict: "above", medianCents: med };
  if (ratio < 0.6) return { verdict: "below", medianCents: med };
  return { verdict: "in_line", medianCents: med };
}

/** Shown to donors (as reassurance) only with at least this many comparable listings. */
export const MIN_COMPARABLES_FOR_DONORS = 8;

/** What each verdict tells a reader, in plain words. */
export const VERDICT_TEXT: Record<PriceVerdict, string> = {
  in_line: "In line with market prices",
  above: "A little above market prices",
  well_above: "Well above market prices - a reviewer checks it",
  below: "Below typical market prices",
  unknown: "No comparable listings found to check against",
};
