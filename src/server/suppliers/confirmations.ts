import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { appUrl } from "@/server/app-url";
import { getDb } from "@/server/db/client";
import { charities, needs, proofs, supplierConfirmations, supplierPayments, suppliers } from "@/server/db/schema";
import { sendMail } from "@/server/mail/mailer";
import { formatUsd } from "@/server/money";

/** Long enough to cover a hold's life (29 days). */
const VALID_MS = 30 * 86_400_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Asks the supplier whether the goods a charity paid for were handed over. Sent
 * to the email PayPal confirmed for the supplier's account - never a contact the
 * charity supplies - and only for verified suppliers (an unverified one could be
 * the charity itself). Safe to call again: one request per payment.
 */
export async function requestSupplierConfirmation(supplierPaymentId: string): Promise<boolean> {
  const db = getDb();
  const [p] = await db
    .select({
      id: supplierPayments.id,
      needId: supplierPayments.needId,
      charityId: supplierPayments.charityId,
      amountCents: supplierPayments.amountCents,
      description: supplierPayments.description,
      completedAt: supplierPayments.completedAt,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierEmail: suppliers.paypalEmail,
      charityName: charities.name,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .innerJoin(charities, eq(charities.id, supplierPayments.charityId))
    .where(and(eq(supplierPayments.id, supplierPaymentId), eq(supplierPayments.status, "completed"), eq(suppliers.status, "connected"), isNotNull(suppliers.verifiedAt)))
    .limit(1);
  if (!p) return false;

  const token = randomBytes(32).toString("base64url");
  // The request and its email are saved together: never a request nobody was told about.
  // (With a real mail provider, the send would move after the commit, with a daily re-send.)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supplierConfirmations)
      .values({
        supplierPaymentId: p.id,
        needId: p.needId,
        charityId: p.charityId,
        supplierId: p.supplierId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + VALID_MS),
      })
      .onConflictDoNothing({ target: supplierConfirmations.supplierPaymentId })
      .returning({ id: supplierConfirmations.id });
    if (!row) return false; // Already asked.
    await sendConfirmationMail(p, token, tx);
    return true;
  });
}

async function sendConfirmationMail(
  p: { supplierEmail: string; charityId: string; charityName: string; supplierName: string; description: string; amountCents: number },
  token: string,
  tx: Parameters<typeof sendMail>[1],
) {
  await sendMail({
    kind: "supplier_confirm_request",
    to: p.supplierEmail,
    charityId: p.charityId,
    subject: `Did ${p.charityName} receive ${p.description}?`,
    text: [
      `${p.charityName} paid ${p.supplierName} ${formatUsd(p.amountCents)} with PayPal for: ${p.description}.`,
      "",
      "Donors pay only after delivery is confirmed. Tell us when the goods have been handed over or collected - it takes one click:",
      "",
      `${appUrl()}/supplier/confirm/${token}`,
      "",
      "If there was no such order, say so on the same page. This link works once and expires in 30 days.",
      "",
      "- Proven (PayPal sandbox demo - no real money moves)",
    ].join("\n"),
  }, tx);
}

/**
 * Asks about completed payments that have no request yet: after a reviewer
 * verifies a supplier (payments made while it was unverified), or from the daily
 * sweep (an email that failed to send). Only verified suppliers are asked.
 */
export async function requestMissingConfirmations(supplierId?: string): Promise<number> {
  const rows = await getDb()
    .select({ id: supplierPayments.id })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(supplierConfirmations, eq(supplierConfirmations.supplierPaymentId, supplierPayments.id))
    .where(
      and(
        supplierId ? eq(supplierPayments.supplierId, supplierId) : undefined,
        eq(supplierPayments.status, "completed"),
        eq(suppliers.status, "connected"),
        isNotNull(suppliers.verifiedAt),
        isNull(supplierConfirmations.id),
      ),
    )
    .limit(50);
  let sent = 0;
  for (const r of rows) sent += Number(await requestSupplierConfirmation(r.id).catch(() => false));
  return sent;
}

export type ConfirmationView = {
  status: "requested" | "confirmed" | "denied";
  charityName: string;
  supplierName: string;
  description: string;
  amountCents: number;
  paidAt: Date | null;
};

/** What the supplier sees behind its link. Opening the link never answers it. */
export async function getConfirmation(token: string): Promise<ConfirmationView | null> {
  if (!TOKEN.test(token)) return null;
  const [c] = await getDb()
    .select({
      status: supplierConfirmations.status,
      expiresAt: supplierConfirmations.expiresAt,
      charityName: charities.name,
      supplierName: suppliers.name,
      description: supplierPayments.description,
      amountCents: supplierPayments.amountCents,
      paidAt: supplierPayments.completedAt,
    })
    .from(supplierConfirmations)
    .innerJoin(supplierPayments, eq(supplierPayments.id, supplierConfirmations.supplierPaymentId))
    .innerJoin(suppliers, eq(suppliers.id, supplierConfirmations.supplierId))
    .innerJoin(charities, eq(charities.id, supplierConfirmations.charityId))
    .where(eq(supplierConfirmations.tokenHash, hash(token)))
    .limit(1);
  if (!c) return null;
  if (c.status === "requested" && c.expiresAt < new Date()) return null;
  return { status: c.status, charityName: c.charityName, supplierName: c.supplierName, description: c.description, amountCents: c.amountCents, paidAt: c.paidAt };
}

/**
 * The supplier answers. "confirmed" adds a passed supplier-confirmation proof (a
 * second check for the release rule). "denied" fails it and sends the PayPal
 * payment proof back to a person, so nothing is released on it. Single use.
 */
export async function answerConfirmation(token: string, answer: "confirmed" | "denied"): Promise<"done" | "already" | "invalid"> {
  if (!TOKEN.test(token)) return "invalid";
  return getDb().transaction(async (tx) => {
    // Need lock first (shared), as releases take it: a "no" can't slip in between a release's check and its capture.
    const [target] = await tx.select({ needId: supplierConfirmations.needId }).from(supplierConfirmations).where(eq(supplierConfirmations.tokenHash, hash(token))).limit(1);
    if (!target) return "invalid";
    await tx.select({ id: needs.id }).from(needs).where(eq(needs.id, target.needId)).for("share");
    const [c] = await tx
      .update(supplierConfirmations)
      .set({ status: answer, answeredAt: new Date() })
      .where(and(eq(supplierConfirmations.tokenHash, hash(token)), eq(supplierConfirmations.status, "requested"), gt(supplierConfirmations.expiresAt, new Date())))
      .returning({
        id: supplierConfirmations.id,
        needId: supplierConfirmations.needId,
        charityId: supplierConfirmations.charityId,
        paymentId: supplierConfirmations.supplierPaymentId,
      });
    if (!c) {
      const [seen] = await tx.select({ id: supplierConfirmations.id }).from(supplierConfirmations).where(eq(supplierConfirmations.tokenHash, hash(token))).limit(1);
      return seen ? "already" : "invalid";
    }
    const [p] = await tx
      .select({ description: supplierPayments.description, amountCents: supplierPayments.amountCents, proofId: supplierPayments.proofId, createdBy: supplierPayments.createdBy, supplierName: suppliers.name })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
      .where(eq(supplierPayments.id, c.paymentId));
    const [proof] = await tx
      .insert(proofs)
      .values({
        needId: c.needId,
        charityId: c.charityId,
        kind: "supplier_confirmation",
        status: answer === "confirmed" ? "passed" : "failed",
        reasons: [
          answer === "confirmed"
            ? `${p!.supplierName} confirmed it handed over ${p!.description} (${formatUsd(p!.amountCents)}) - answered at the email PayPal holds for its account.`
            : `${p!.supplierName} said this order isn't right - answered at the email PayPal holds for its account.`,
        ],
        // The person who started the payment; the answer itself came from the supplier's link.
        submittedBy: p!.createdBy,
      })
      .returning({ id: proofs.id });
    await tx.update(supplierConfirmations).set({ proofId: proof!.id }).where(eq(supplierConfirmations.id, c.id));
    if (answer === "denied" && p!.proofId) {
      await tx
        .update(proofs)
        .set({ status: "needs_review", reasons: sql`array_append(${proofs.reasons}, ${"The supplier said this order isn't right - a person checks it."})` })
        .where(and(eq(proofs.id, p!.proofId), ne(proofs.status, "failed")));
    }
    return "done";
  });
}

/** Supplier-confirmation state per payment, for the charity's own need page. */
export async function confirmationStatusByPayment(charityId: string, needId: string): Promise<Map<string, "requested" | "confirmed" | "denied">> {
  const rows = await getDb()
    .select({ paymentId: supplierConfirmations.supplierPaymentId, status: supplierConfirmations.status })
    .from(supplierConfirmations)
    .where(and(eq(supplierConfirmations.needId, needId), eq(supplierConfirmations.charityId, charityId)));
  return new Map(rows.map((r) => [r.paymentId, r.status]));
}
