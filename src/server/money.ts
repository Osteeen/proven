// Money is integer cents everywhere. Floats never touch an amount.

export type Cents = number & { readonly __brand: "Cents" };

const AMOUNT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("cents must be a non-negative integer");
  return n as Cents;
}

/** Parse a decimal string like "12.34" (as PayPal and forms send it) into cents. */
export function toCents(amount: string): Cents {
  const m = AMOUNT.exec(amount);
  if (!m) throw new Error("invalid amount");
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  return cents(whole * 100 + frac);
}

/** Format cents as the decimal string PayPal expects, e.g. 1234 -> "12.34". */
export function toPayPalValue(c: Cents): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Format cents for people, e.g. 123456 -> "$1,234.56". Integer maths only. */
export function formatUsd(c: number): string {
  const whole = Math.floor(c / 100).toLocaleString("en-US");
  return `$${whole}.${String(c % 100).padStart(2, "0")}`;
}
