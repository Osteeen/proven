// Pure rules for receipts. The AI only READS the receipt; these rules - plain
// code, fully tested - decide whether it passes, needs a person, or fails.
// The AI never decides on money.

export type ReceiptReading = {
  is_receipt: boolean;
  merchant_name: string | null;
  receipt_number: string | null;
  purchase_date: string | null; // YYYY-MM-DD as printed
  currency: string | null; // ISO code, e.g. "USD"
  line_items: { description: string; quantity: number | null; unit_price_cents: number | null; line_total_cents: number | null }[];
  total_cents: number | null;
  matches_need: "yes" | "partly" | "no" | "unclear";
  match_reason: string;
  edit_signs: string[];
  concerns: string[];
  confidence: "high" | "medium" | "low";
};

export type NeedFacts = { amountCents: number; createdAt: Date; deadline: Date };

export type Duplicates = {
  /** The same receipt (same image, or any key matching) is on a different need - here or at another charity. */
  otherNeed: boolean;
  /** How it matched, for the reviewer: "image" or "details". */
  how: "image" | "details" | null;
};

export type ReceiptDecision = { status: "passed" | "needs_review" | "failed"; reasons: string[]; amountCents: number | null };

const DAY = 24 * 60 * 60 * 1000;
/** Shopping can start a little before a need is posted (an urgent purchase, then the ask). */
const EARLY_PURCHASE_DAYS = 7;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every way this receipt can be recognised again, independent of the photo.
 * Several keys so a crop that hides one detail (the number, or the shop name)
 * still matches on another. The AI writes these, so they are normalised hard.
 */
export function receiptKeys(r: Pick<ReceiptReading, "merchant_name" | "receipt_number" | "purchase_date" | "total_cents">): string[] {
  if (r.total_cents === null || r.total_cents <= 0) return [];
  const keys: string[] = [];
  const number = r.receipt_number ? norm(r.receipt_number).replace(/o/g, "0") : "";
  const shop = r.merchant_name ? norm(r.merchant_name).replace(/(company|co|inc|llc|ltd|store|shop)$/g, "") : "";
  if (number) keys.push(`num:${number}|${r.total_cents}`);
  if (r.purchase_date) keys.push(`date:${r.purchase_date}|${r.total_cents}`);
  if (shop && r.purchase_date) keys.push(`shop:${shop}|${r.purchase_date}|${r.total_cents}`);
  return keys;
}

export function assessReceipt(r: ReceiptReading, need: NeedFacts, dup: Duplicates, now: Date): ReceiptDecision {
  const fail = (reason: string): ReceiptDecision => ({ status: "failed", reasons: [reason], amountCents: null });

  if (!r.is_receipt) return fail("This doesn't look like a receipt.");
  if (r.matches_need === "no") return fail(`It doesn't match the need. AI read: ${clip(r.match_reason)}`);

  const review: string[] = [];
  // A cross-need match is never decided by "who uploaded first": both go to a person.
  if (dup.otherNeed) {
    review.push(
      dup.how === "image"
        ? "The same receipt image was submitted for a different need - a person will compare them."
        : "A receipt with the same details was submitted for a different need - a person will compare them.",
    );
  }
  // A receipt must be recognisable again (shop, total, and a number or date), or duplicates can't be caught.
  if (!r.merchant_name || r.total_cents === null || r.total_cents <= 0 || (!r.receipt_number && !r.purchase_date)) {
    review.push("The shop, total and receipt number or date couldn't all be read.");
  } else if (r.total_cents > need.amountCents) {
    review.push("The receipt total is more than the need's cost.");
  }
  if (r.currency?.toUpperCase() !== "USD") review.push(r.currency ? `The receipt is in ${r.currency}, not US dollars.` : "The currency couldn't be read.");

  const sum = r.line_items.reduce((s, i) => s + (i.line_total_cents ?? 0), 0);
  const allLines = r.line_items.length > 0 && r.line_items.every((i) => i.line_total_cents !== null);
  // Lines may legitimately differ from the total by tax; a gap above 15% is worth a look.
  if (allLines && r.total_cents && sum > 0 && Math.abs(r.total_cents - sum) > r.total_cents * 0.15) {
    review.push("The line items don't add up to the total.");
  }

  if (r.purchase_date) {
    const bought = Date.parse(`${r.purchase_date}T12:00:00Z`);
    if (Number.isNaN(bought)) review.push("The purchase date couldn't be read.");
    else if (bought < need.createdAt.getTime() - EARLY_PURCHASE_DAYS * DAY) review.push("It was bought well before the need was posted.");
    else if (bought > now.getTime() + DAY) review.push("The receipt is dated in the future.");
  }

  if (r.edit_signs.length) review.push(`Possible editing. AI read: ${clip(r.edit_signs.join("; "))}`);
  if (r.matches_need === "partly" || r.matches_need === "unclear") review.push(`Only a partial match to the need. AI read: ${clip(r.match_reason)}`);
  if (r.confidence === "low") review.push("The receipt was hard to read.");

  if (review.length) return { status: "needs_review", reasons: review, amountCents: r.total_cents && r.total_cents > 0 ? r.total_cents : null };
  return { status: "passed", reasons: [`AI read: ${clip(r.match_reason)}`], amountCents: r.total_cents };
}

/** AI-written text is shown labelled and short, so it can't pass for Proven's own words. */
function clip(text: string, max = 240): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}...` : t;
}
