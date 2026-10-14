// Pure rules for the recipient check. No database, so every rule is unit-tested.

const MAX_RECIPIENTS = 1000;

/** Fewer recipients than this and the check never passes on its own: one or two numbers are too easy to fake. */
export const MIN_LIST_FOR_AUTO = 5;

/**
 * "+1 (555) 010-2233" -> "+15550102233". International form only: a leading +
 * (or 00) and the country code, 8 to 15 digits. One handset always gives one
 * value, so the same person can't fill several sample slots. Null otherwise.
 */
export function normalizePhone(raw: string): string | null {
  let t = raw.trim();
  if (!/^(\+|00)[\d\s().-]+$/.test(t)) return null;
  if (t.startsWith("00")) t = `+${t.slice(2)}`;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

/** One number per line (commas and semicolons work too). Duplicates count once. */
export function parseRecipients(text: string): { numbers: string[]; invalid: number; tooMany: boolean } {
  const parts = text.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const numbers = new Set<string>();
  let invalid = 0;
  for (const p of parts) {
    const n = normalizePhone(p);
    if (n) numbers.add(n);
    else invalid++;
  }
  return { numbers: [...numbers], invalid, tooMany: numbers.size > MAX_RECIPIENTS };
}

/** How many to ask: everyone when there are 3 or fewer, else 10% (at least 3, at most 10). */
export function sampleSize(total: number): number {
  if (total <= 3) return total;
  return Math.min(10, Math.max(3, Math.ceil(total * 0.1)));
}

/** "Yes" answers needed: half the sample, rounded up. */
export function yesNeeded(sample: number): number {
  return Math.max(1, Math.ceil(sample / 2));
}

/**
 * The proof's state from the answers so far. Any "no" goes to a person, and so
 * does a list that shares numbers with another charity's need. Otherwise it
 * passes once half the sample said yes; until then it is still being checked.
 */
export function recipientStatus(input: { sample: number; total: number; yes: number; no: number; sharedNumbers: number; expired: boolean }): {
  status: "checking" | "passed" | "needs_review";
  reasons: string[];
} {
  const waiting = input.sample - input.yes - input.no;
  const tally = `Asked ${input.sample} ${input.sample === 1 ? "recipient" : "recipients"} picked at random by Proven: ${input.yes} said yes, ${input.no} said no, ${waiting} yet to answer.`;
  const reasons = [tally];
  if (input.no > 0) {
    reasons.push(`${input.no === 1 ? "A recipient" : `${input.no} recipients`} said they didn't receive it - a person checks it.`);
    return { status: "needs_review", reasons };
  }
  if (input.yes >= yesNeeded(input.sample)) {
    // Never says why to the charity (which numbers matched another charity's list is a reviewer's business).
    if (input.sharedNumbers > 0 || input.total < MIN_LIST_FOR_AUTO) {
      reasons.push("A Proven reviewer looks over this list before it counts.");
      return { status: "needs_review", reasons };
    }
    return { status: "passed", reasons };
  }
  if (input.expired) {
    reasons.push("Not enough recipients answered in time - a person checks it.");
    return { status: "needs_review", reasons };
  }
  return { status: "checking", reasons };
}

/** "+15550102233" -> "+•••••••2233": enough to recognise, not to call. */
export function maskPhone(n: string): string {
  return `${n.startsWith("+") ? "+" : ""}${"•".repeat(Math.max(0, n.replace("+", "").length - 4))}${n.slice(-4)}`;
}
