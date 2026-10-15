import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { proofs, recipientChecks, recipientContacts, supplierConfirmations, supplierPayments, suppliers } from "@/server/db/schema";
import { formatUsd } from "@/server/money";

/**
 * A donor's impact receipt for a proven need: what the money bought and how
 * Proven knows, written ONLY from facts Proven recorded - PayPal's own record of
 * paying the supplier, checks that passed. No AI writing (the market-price estimate stays out),
 * nothing a charity typed is presented as verified. Donors' and recipients'
 * identities never appear.
 */
export async function impactFacts(needId: string): Promise<string[]> {
  const db = getDb();
  const facts: string[] = [];

  // What was bought is the charity's own description - stated only when the supplier confirmed
  // that very payment (its confirmation email quoted it); otherwise just the payment itself.
  const paid = await db
    .select({ name: suppliers.name, cents: supplierPayments.amountCents, description: supplierPayments.description, confirmed: supplierConfirmations.status })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .innerJoin(proofs, eq(proofs.id, supplierPayments.proofId))
    .leftJoin(supplierConfirmations, eq(supplierConfirmations.supplierPaymentId, supplierPayments.id))
    .where(and(eq(supplierPayments.needId, needId), eq(supplierPayments.status, "completed"), eq(proofs.status, "passed")));
  for (const p of paid)
    facts.push(
      p.confirmed === "confirmed"
        ? `${formatUsd(p.cents)} paid to ${cleanName(p.name)} with PayPal for ${p.description} - PayPal recorded the payment and ${cleanName(p.name)} confirmed the order.`
        : `${formatUsd(p.cents)} paid to ${cleanName(p.name)} with PayPal - PayPal's own record of the payment.`,
    );

  const passed = await db
    .select({ kind: proofs.kind, n: sql<number>`count(*)::int` })
    .from(proofs)
    .where(and(eq(proofs.needId, needId), eq(proofs.status, "passed")))
    .groupBy(proofs.kind);
  const has = (k: string) => passed.some((p) => p.kind === k);
  if (has("receipt")) facts.push("The supplier's receipt was read and matched to this need.");
  if (has("supplier_confirmation")) {
    const [s] = await db
      .select({ name: suppliers.name })
      .from(supplierConfirmations)
      .innerJoin(suppliers, eq(suppliers.id, supplierConfirmations.supplierId))
      .where(and(eq(supplierConfirmations.needId, needId), eq(supplierConfirmations.status, "confirmed")))
      .limit(1);
    facts.push(`${s ? cleanName(s.name) : "The supplier"} confirmed it handed the goods over.`);
  }
  if (has("recipient_confirmation")) {
    const [r] = await db
      .select({
        sample: recipientChecks.sampleSize,
        yes: sql<number>`count(${recipientContacts.id}) filter (where ${recipientContacts.answer} = 'yes')::int`,
      })
      .from(recipientChecks)
      .leftJoin(recipientContacts, eq(recipientContacts.checkId, recipientChecks.id))
      .where(eq(recipientChecks.needId, needId))
      .groupBy(recipientChecks.id);
    if (r && r.yes > 0) facts.push(`${r.yes} of ${r.sample} people who received help, picked at random by Proven, confirmed it reached them.`);
  }
  return facts;
}

/** "Valley Supply Co. - Demo supplier (PayPal sandbox)" -> "Valley Supply Co.": the sandbox label stays on the page, not in every sentence. */
function cleanName(name: string): string {
  return name.replace(/\s+-\s+Demo supplier \(PayPal sandbox\)$/, "");
}
