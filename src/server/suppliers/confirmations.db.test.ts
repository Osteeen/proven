// Local database, no PayPal calls. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/suppliers/confirmations.db.test.ts
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, memberships, messages, needs, proofs, supplierConfirmations, supplierPayments, suppliers, users } from "@/server/db/schema";
import { answerConfirmation, getConfirmation, requestSupplierConfirmation } from "./confirmations";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();

run("supplier confirmations (local DB)", () => {
  const db = () => getDb();
  let charityId = "";
  let userId = "";
  let needId = "";
  let verified = "";
  let unverified = "";
  const made = { suppliers: [] as string[] };

  beforeAll(async () => {
    const [u] = await db().insert(users).values({ id: `conf-${stamp}`, email: `conf-${stamp}@proven.test` }).returning({ id: users.id });
    const [c] = await db()
      .insert(charities)
      .values({ name: "Confirm test", paypalTrackingId: `conf-${stamp}`, paypalMerchantId: `CONF${stamp}`, status: "active" })
      .returning({ id: charities.id });
    await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
    const [n] = await db()
      .insert(needs)
      .values({ charityId: c!.id, title: "Blankets", description: "Blankets", amountCents: 50000, deadline: new Date(Date.now() + 6 * 86400000), requiredProof: ["supplier_paypal_payment", "supplier_confirmation"], status: "open" })
      .returning({ id: needs.id });
    const sup = async (tag: string, isVerified: boolean) =>
      (
        await db()
          .insert(suppliers)
          .values({
            name: `Supply ${tag}`,
            paypalEmail: `conf-${tag}-${stamp}@business.example.com`,
            paypalTrackingId: `conf-${tag}-${stamp}`,
            paypalMerchantId: `CONF${tag}${stamp}`,
            status: "connected",
            connectedAt: new Date(),
            verifiedAt: isVerified ? new Date() : null,
          })
          .returning({ id: suppliers.id })
      )[0]!.id;
    verified = await sup("V", true);
    unverified = await sup("U", false);
    made.suppliers.push(verified, unverified);
    charityId = c!.id;
    userId = u!.id;
    needId = n!.id;
  });

  afterAll(async () => {
    await db().update(supplierConfirmations).set({ proofId: null }).where(eq(supplierConfirmations.needId, needId));
    await db().update(supplierPayments).set({ proofId: null }).where(eq(supplierPayments.needId, needId));
    await db().delete(supplierConfirmations).where(eq(supplierConfirmations.needId, needId));
    await db().delete(proofs).where(eq(proofs.needId, needId));
    await db().delete(supplierPayments).where(eq(supplierPayments.needId, needId));
    await db().delete(suppliers).where(inArray(suppliers.id, made.suppliers));
    await db().delete(messages).where(eq(messages.charityId, charityId));
    await db().delete(needs).where(eq(needs.id, needId));
    await db().delete(memberships).where(eq(memberships.charityId, charityId));
    await db().delete(charities).where(eq(charities.id, charityId));
    await db().delete(users).where(eq(users.id, userId));
  });

  /** A completed supplier payment with its passed PayPal proof, as completeSupplierPayment leaves it. */
  const paid = async (supplierId: string, cents: number) => {
    const [proof] = await db()
      .insert(proofs)
      .values({ needId, charityId, kind: "supplier_paypal_payment", status: "passed", amountCents: cents, submittedBy: userId })
      .returning({ id: proofs.id });
    const [p] = await db()
      .insert(supplierPayments)
      .values({ needId, charityId, supplierId, amountCents: cents, description: "50 wool blankets", status: "completed", createdBy: userId, completedAt: new Date(), proofId: proof!.id })
      .returning({ id: supplierPayments.id });
    return { paymentId: p!.id, proofId: proof!.id };
  };
  const tokenFromInbox = async (to: string) => {
    const [m] = await db()
      .select({ body: messages.bodyText })
      .from(messages)
      .where(and(eq(messages.charityId, charityId), eq(messages.toEmail, to), eq(messages.kind, "supplier_confirm_request")));
    return m!.body!.match(/\/supplier\/confirm\/([A-Za-z0-9_-]{43})/)![1]!;
  };

  it("never asks an unverified supplier - it could be the charity itself", async () => {
    const { paymentId } = await paid(unverified, 1000);
    expect(await requestSupplierConfirmation(paymentId)).toBe(false);
  });

  it("asks a verified supplier once, at its PayPal email, and a yes adds a passed proof", async () => {
    const { paymentId } = await paid(verified, 20000);
    expect(await requestSupplierConfirmation(paymentId)).toBe(true);
    expect(await requestSupplierConfirmation(paymentId)).toBe(false);
    const token = await tokenFromInbox(`conf-v-${stamp}@business.example.com`.replace("conf-v", "conf-V"));
    expect((await getConfirmation(token))?.status).toBe("requested");
    // Only the hash is stored.
    const stored = await db().select({ h: supplierConfirmations.tokenHash }).from(supplierConfirmations).where(eq(supplierConfirmations.supplierPaymentId, paymentId));
    expect(stored[0]!.h).not.toContain(token);

    expect(await answerConfirmation(token, "confirmed")).toBe("done");
    expect(await answerConfirmation(token, "denied")).toBe("already");
    const kinds = await db().select({ kind: proofs.kind, status: proofs.status }).from(proofs).where(and(eq(proofs.needId, needId), eq(proofs.kind, "supplier_confirmation")));
    expect(kinds).toEqual([{ kind: "supplier_confirmation", status: "passed" }]);
  });

  it("a no fails the confirmation and sends the PayPal payment proof to a person", async () => {
    const { paymentId, proofId } = await paid(verified, 5000);
    await requestSupplierConfirmation(paymentId);
    const [row] = await db().select({ id: supplierConfirmations.id }).from(supplierConfirmations).where(eq(supplierConfirmations.supplierPaymentId, paymentId));
    // Find this payment's token: the newest mail to that supplier.
    const mails = await db()
      .select({ body: messages.bodyText })
      .from(messages)
      .where(and(eq(messages.charityId, charityId), eq(messages.kind, "supplier_confirm_request")));
    const tokens = mails.map((m) => m.body!.match(/\/supplier\/confirm\/([A-Za-z0-9_-]{43})/)![1]!);
    let token = "";
    for (const t of tokens) if ((await getConfirmation(t))?.status === "requested") token = t;
    expect(row).toBeDefined();
    expect(await answerConfirmation(token, "denied")).toBe("done");
    const [payProof] = await db().select({ status: proofs.status }).from(proofs).where(eq(proofs.id, proofId));
    expect(payProof!.status).toBe("needs_review");
  });

  it("refuses made-up and expired links", async () => {
    expect(await answerConfirmation("x".repeat(43), "confirmed")).toBe("invalid");
    expect(await answerConfirmation("../../etc", "confirmed")).toBe("invalid");
    const { paymentId } = await paid(verified, 1000);
    await requestSupplierConfirmation(paymentId);
    await db().update(supplierConfirmations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(supplierConfirmations.supplierPaymentId, paymentId));
    const mails = await db().select({ body: messages.bodyText }).from(messages).where(and(eq(messages.charityId, charityId), eq(messages.kind, "supplier_confirm_request")));
    for (const m of mails) {
      const t = m.body!.match(/\/supplier\/confirm\/([A-Za-z0-9_-]{43})/)![1]!;
      const view = await getConfirmation(t);
      if (view?.status === "requested") throw new Error("an expired link still shows as open");
    }
  });
});
