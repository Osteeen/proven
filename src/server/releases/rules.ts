// Pure money rules for releasing held donations. No database, no PayPal - so
// every rule here is unit-tested.

export type Hold = { donationId: string; availableCents: number };
export type Share = { donationId: string; cents: number };

/**
 * Splits `totalCents` across donors' holds in proportion to what each still has
 * held, so every donor is charged the same share of their gift. Leftover cents
 * from rounding go to the holds with the largest remainders (ties: earlier
 * holds first). Never takes more than a hold has, and the shares always add up
 * to exactly `totalCents`.
 */
export function allocate(totalCents: number, holds: Hold[]): Share[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("total must be a non-negative integer");
  const available = holds.reduce((s, h) => s + h.availableCents, 0);
  if (totalCents > available) throw new Error("cannot release more than is held");
  if (totalCents === 0 || available === 0) return holds.map((h) => ({ donationId: h.donationId, cents: 0 }));

  // BigInt: total x hold can exceed 2^53 for large needs, and floats would drift.
  const big = BigInt(available);
  const exact = holds.map((h, i) => {
    const product = BigInt(totalCents) * BigInt(h.availableCents);
    return { i, donationId: h.donationId, floor: Number(product / big), rem: Number(product % big), cap: h.availableCents };
  });
  let left = totalCents - exact.reduce((s, e) => s + e.floor, 0);
  const order = [...exact].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const e of order) {
    if (left === 0) break;
    if (e.floor < e.cap) {
      e.floor += 1;
      left -= 1;
    }
  }
  return exact.map((e) => ({ donationId: e.donationId, cents: e.floor }));
}

/** Most a charity may take up front ("part on booking") before delivery. */
export function advanceCapCents(needAmountCents: number, trustTier: "new" | "established" | "trusted"): number {
  const pct = trustTier === "new" ? 25 : 50;
  return Math.floor((needAmountCents * pct) / 100);
}

/**
 * Until the Build 2 proof checks (AI receipt reading, supplier and recipient
 * confirmations) run, nothing has checked a delivery automatically - so every
 * delivery release goes to a person (Osteen, Oct 12). Flip once they are live.
 */
export const PROOF_CHECKS_AUTOMATED = false;

/** Why a release must wait for a person, or null when it can go straight through. */
export function reviewReason(input: {
  kind: "advance" | "final";
  trustTier: "new" | "established" | "trusted";
  completedReleases: number;
  amountCents: number;
  thresholdCents: number;
}): string | null {
  if (input.trustTier === "new" && input.completedReleases === 0) return "First release by a new charity";
  if (input.amountCents > input.thresholdCents) return "Above this charity's review threshold";
  if (input.kind === "final" && !PROOF_CHECKS_AUTOMATED) return "Delivery proof is checked by a person";
  return null;
}
