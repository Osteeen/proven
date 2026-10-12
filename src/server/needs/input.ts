import { z } from "zod";
import { toCents } from "@/server/money";

export const PROOF_TYPES = ["receipt", "supplier_confirmation", "recipient_confirmation", "live_photo", "supplier_paypal_payment"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export const PROOF_LABELS: Record<ProofType, string> = {
  receipt: "Receipt",
  supplier_confirmation: "Supplier confirms",
  recipient_confirmation: "Recipient confirms",
  live_photo: "Live photo",
  supplier_paypal_payment: "Supplier paid with PayPal",
};

// Proof the charity produces itself vs proof from someone else. Release needs
// two checks from different sources, so every need requires at least one
// independent (third-party) proof.
export const OWN_EVIDENCE: readonly ProofType[] = ["receipt", "live_photo"];
export const INDEPENDENT_PROOF: readonly ProofType[] = ["supplier_confirmation", "supplier_paypal_payment", "recipient_confirmation"];

export const FUNDING_MODELS = ["reimbursement", "staged"] as const;
export type FundingModel = (typeof FUNDING_MODELS)[number];

// A PayPal hold lasts 29 days; the deadline must fall inside it with a day to spare.
export const MAX_DEADLINE_DAYS = 28;
export const MAX_NEED_CENTS = 100_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Date-picker bounds (YYYY-MM-DD) that match the server rules below. */
export function deadlineBounds(now: number = Date.now()): { min: string; max: string; today: string } {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // Tomorrow is the earliest: a deadline runs to the end of its day (UTC), so tomorrow is always at least a day away.
  return { min: iso(now + DAY_MS), max: iso(now + (MAX_DEADLINE_DAYS - 1) * DAY_MS), today: iso(now) };
}

export type NeedInput = {
  title: string;
  description: string;
  amountCents: number;
  deadline: Date;
  fundingModel: FundingModel;
  requiredProof: ProofType[];
};

export type FieldErrors = Partial<Record<"title" | "description" | "amount" | "deadline" | "fundingModel" | "requiredProof", string>>;

const schema = z.object({
  title: z.string().trim().min(3, "Give the need a short title").max(120, "Keep the title under 120 characters"),
  description: z.string().trim().min(10, "Say what the money buys and for whom").max(2000, "Keep the description under 2,000 characters"),
  amount: z.string().trim(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a delivery date"),
  fundingModel: z.enum(FUNDING_MODELS, { message: "Choose how the money is released" }),
  requiredProof: z.array(z.enum(PROOF_TYPES)).min(2, "Choose at least two kinds of proof - release needs two checks to agree"),
});

/**
 * Validates a "post a need" form. Pure: `now` is passed in, so the rules are
 * unit-tested without a database.
 */
export function parseNeedInput(
  raw: { title: unknown; description: unknown; amount: unknown; deadline: unknown; fundingModel: unknown; requiredProof: unknown },
  opts: { now: Date },
): { ok: true; value: NeedInput } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(raw);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      errors[key] ??= issue.message;
    }
  }

  const uniqueProof = parsed.success ? [...new Set(parsed.data.requiredProof)] : [];
  if (parsed.success && uniqueProof.length < 2) errors.requiredProof = "Choose at least two kinds of proof - release needs two checks to agree";
  else if (parsed.success && !uniqueProof.some((p) => INDEPENDENT_PROOF.includes(p)))
    errors.requiredProof = "Add at least one independent confirmation - your own evidence alone can't release money";

  let amountCents: number | undefined;
  if (typeof raw.amount === "string") {
    try {
      amountCents = toCents(raw.amount.trim().replace(/^\$/, "").replace(/,/g, ""));
    } catch {
      errors.amount = "Enter an amount like 500 or 499.50";
    }
  }
  if (amountCents !== undefined && !errors.amount) {
    if (amountCents < 100) errors.amount = "The smallest need is $1.00";
    // A typo guard, not a limit on charities: risk is controlled when money is released.
    else if (amountCents > MAX_NEED_CENTS) errors.amount = "Enter an amount under $1,000,000";
  }

  let deadline: Date | undefined;
  if (typeof raw.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) {
    // End of the chosen day, UTC.
    deadline = new Date(`${raw.deadline}T23:59:59Z`);
    if (Number.isNaN(deadline.getTime())) errors.deadline = "Pick a delivery date";
    else if (deadline.getTime() < opts.now.getTime() + DAY_MS) errors.deadline = "Give at least a day to deliver";
    else if (deadline.getTime() > opts.now.getTime() + MAX_DEADLINE_DAYS * DAY_MS)
      errors.deadline = `Delivery must be within ${MAX_DEADLINE_DAYS} days - a PayPal hold lasts 29`;
  }

  if (!parsed.success || Object.keys(errors).length > 0 || amountCents === undefined || !deadline) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title: parsed.data.title,
      description: parsed.data.description,
      amountCents,
      deadline,
      fundingModel: parsed.data.fundingModel,
      requiredProof: uniqueProof,
    },
  };
}
