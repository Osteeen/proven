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

/** Proof kinds that count as the second check next to the PayPal supplier payment. */
export const SECOND_CHECKS = ["receipt", "supplier_confirmation", "recipient_confirmation", "live_photo"] as const;

export type ReleaseProof = {
  /** The need asks for "Supplier paid with PayPal" (every new need does). */
  requiresSupplierPayment: boolean;
  /** Supplier payments through Proven whose proof currently passes (verified supplier, not refunded or disputed). */
  supplierPaidCents: number;
  /** Kinds of other proof that currently pass. */
  passedKinds: readonly string[];
  /** The second checks this need promised donors (its required proof, less the supplier payment). */
  requiredSecondChecks: readonly string[];
  /** Proofs on the need that failed, wait for a person, or are still being checked. */
  openIssues: number;
  /** Already taken from donors for this need (booking payment included). */
  releasedCents: number;
};

/**
 * The final-release rule (Osteen, Oct 14): PayPal's own record of paying the
 * supplier is the main proof, plus at least one second check, and donors are
 * never charged more than was paid to suppliers. Returns why a release of
 * `amountCents` can't go ahead, or null. Needs posted before the rule don't ask
 * for a supplier payment, so they keep going to a person instead.
 */
export function finalReleaseBlock(p: ReleaseProof, amountCents: number): string | null {
  if (!p.requiresSupplierPayment) return null;
  if (p.supplierPaidCents <= 0) return "Pay the supplier with PayPal through Proven first - PayPal's record of that payment is the main proof.";
  if (!countedSecondChecks(p).length) return "Add a second check that passes - one of the checks this need asks for.";
  const room = finalReleaseRoomCents(p);
  if (amountCents > room) return `You can release up to ${usd(room)} - what you paid suppliers with PayPal, less what was already released.`;
  return null;
}

/** Most a final release may take: what was paid to suppliers with PayPal, less what was already released. */
export function finalReleaseRoomCents(p: ReleaseProof): number {
  return Math.max(0, p.supplierPaidCents - p.releasedCents);
}

/** Passed second checks that count: only kinds this need asked for (any second check if it named none). */
function countedSecondChecks(p: ReleaseProof): string[] {
  const allowed = p.requiredSecondChecks.length ? p.requiredSecondChecks : SECOND_CHECKS;
  return p.passedKinds.filter((k) => (allowed as readonly string[]).includes(k));
}

/**
 * Everything the need promised donors has passed and nothing is in doubt, so a
 * person doesn't have to check the delivery. Any failed proof, any proof
 * waiting for a person (a recipient said no, a supplier denied, a duplicate
 * receipt) or still being checked sends the release to review instead.
 */
export function proofChecked(p: ReleaseProof): boolean {
  if (!p.requiresSupplierPayment || p.supplierPaidCents <= 0 || p.openIssues > 0) return false;
  const required = p.requiredSecondChecks.length ? p.requiredSecondChecks : null;
  const allPassed = required ? required.every((k) => p.passedKinds.includes(k)) : countedSecondChecks(p).length > 0;
  // The supplier's own "yes" comes from the same party as the payment: a colluding
  // supplier could give both. Skipping review also needs a check from someone else.
  return allPassed && p.passedKinds.some((k) => (BEYOND_SUPPLIER as readonly string[]).includes(k));
}

/** Second checks that don't rest on the supplier's word alone (Osteen, Oct 14). */
export const BEYOND_SUPPLIER = ["receipt", "recipient_confirmation"] as const;

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Why a release must wait for a person, or null when it can go straight through. */
export function reviewReason(input: {
  kind: "advance" | "final";
  trustTier: "new" | "established" | "trusted";
  completedReleases: number;
  amountCents: number;
  thresholdCents: number;
  /** For a final release: the supplier payment and a second check both passed. */
  proofChecked?: boolean;
  /** The need is bought through Proven (asks for "Supplier paid with PayPal"). */
  requiresSupplierPayment?: boolean;
}): string | null {
  if (input.trustTier === "new" && input.completedReleases === 0) return "First release by a new charity";
  if (input.amountCents > input.thresholdCents) return "Above this charity's review threshold";
  // Up-front money has no delivery proof yet: on needs bought through Proven a person always looks.
  if (input.kind === "advance" && input.requiresSupplierPayment) return "Booking payment before any proof";
  if (input.kind === "final" && !input.proofChecked) return "Delivery proof is checked by a person";
  return null;
}
