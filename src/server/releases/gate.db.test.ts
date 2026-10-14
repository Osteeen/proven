// Local database. The final-release rule, with no PayPal calls: every case here
// stops before money moves. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/releases/gate.db.test.ts
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, donations, ledgerEntries, memberships, needs, proofs, releases, supplierPayments, suppliers, users } from "@/server/db/schema";
import { listWithdrawnProofNeeds } from "@/server/suppliers/service";
import { proofChecked } from "./rules";
import { approveRelease, getReleaseProof, requestRelease } from "./service";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();

run("final-release rule (local DB)", () => {
  const db = () => getDb();
  let ctx: { userId: string; charityId: string; charityName: string; isDemo: boolean };
  let reviewerId = "";
  let needId = "";
  let supplierId = "";
  const made = { charities: [] as string[], users: [] as string[], needs: [] as string[] };

  beforeAll(async () => {
    const [u] = await db().insert(users).values({ id: `gate-${stamp}`, email: `gate-${stamp}@proven.test` }).returning({ id: users.id });
    const [r] = await db().insert(users).values({ id: `gate-rev-${stamp}`, email: `gate-rev-${stamp}@proven.test`, role: "reviewer" }).returning({ id: users.id });
    // A new charity: its first release always waits for a person, so nothing reaches PayPal here.
    const [c] = await db()
      .insert(charities)
      .values({ name: "Gate test", paypalTrackingId: `gate-${stamp}`, paypalMerchantId: `GATE${stamp}`, status: "active", trustTier: "new" })
      .returning({ id: charities.id });
    await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
    const [n] = await db()
      .insert(needs)
      .values({
        charityId: c!.id,
        title: "Gate need",
        description: "Gate",
        amountCents: 50000,
        deadline: new Date(Date.now() + 6 * 86400000),
        requiredProof: ["supplier_paypal_payment", "receipt"],
        status: "open",
      })
      .returning({ id: needs.id });
    await db().insert(donations).values({
      needId: n!.id,
      charityId: c!.id,
      amountCents: 50000,
      createRequestId: randomUUID(),
      donorAccessHash: `gate-${stamp}`,
      status: "authorized",
      paypalAuthorizationId: `AUTH-GATE-${stamp}`,
    });
    made.users.push(u!.id, r!.id);
    made.charities.push(c!.id);
    made.needs.push(n!.id);
    ctx = { userId: u!.id, charityId: c!.id, charityName: "Gate test", isDemo: false };
    reviewerId = r!.id;
    needId = n!.id;
    const [s] = await db()
      .insert(suppliers)
      .values({ name: "Gate Supply", paypalEmail: `gate-sup-${stamp}@business.example.com`, paypalTrackingId: `gate-sup-${stamp}`, paypalMerchantId: `GSUP${stamp}`, status: "connected", connectedAt: new Date(), verifiedAt: new Date() })
      .returning({ id: suppliers.id });
    supplierId = s!.id;
  });

  afterAll(async () => {
    await db().delete(releases).where(inArray(releases.needId, made.needs));
    await db().update(supplierPayments).set({ proofId: null }).where(inArray(supplierPayments.needId, made.needs));
    await db().delete(supplierPayments).where(inArray(supplierPayments.needId, made.needs));
    await db().delete(suppliers).where(eq(suppliers.id, supplierId));
    await db().delete(proofs).where(inArray(proofs.needId, made.needs));
    await db().delete(ledgerEntries).where(inArray(ledgerEntries.charityId, made.charities));
    await db().delete(donations).where(inArray(donations.needId, made.needs));
    await db().delete(needs).where(inArray(needs.id, made.needs));
    await db().delete(memberships).where(inArray(memberships.charityId, made.charities));
    await db().delete(charities).where(inArray(charities.id, made.charities));
    for (const id of made.users) await db().delete(users).where(eq(users.id, id));
  });

  const addProof = async (kind: "supplier_paypal_payment" | "receipt", amountCents: number) => {
    const [proof] = await db()
      .insert(proofs)
      .values({ needId, charityId: ctx.charityId, kind, status: "passed", amountCents, submittedBy: ctx.userId })
      .returning({ id: proofs.id });
    // A supplier proof only counts with its completed payment behind it, as completeSupplierPayment leaves it.
    if (kind === "supplier_paypal_payment")
      await db()
        .insert(supplierPayments)
        .values({ needId, charityId: ctx.charityId, supplierId, amountCents, description: "Blankets", status: "completed", createdBy: ctx.userId, completedAt: new Date(), proofId: proof!.id });
    return proof!.id;
  };

  it("refuses a final release before the supplier is paid with PayPal", async () => {
    await expect(requestRelease(ctx, needId, { kind: "final", amountCents: 10000 })).rejects.toThrow(/Pay the supplier/);
  });

  let supplierProof = "";
  it("refuses it with the supplier payment alone", async () => {
    supplierProof = await addProof("supplier_paypal_payment", 20000);
    await expect(requestRelease(ctx, needId, { kind: "final", amountCents: 10000 })).rejects.toThrow(/second check/);
  });

  it("caps it at what was paid to suppliers", async () => {
    await addProof("receipt", 20000);
    await expect(requestRelease(ctx, needId, { kind: "final", amountCents: 20001 })).rejects.toThrow(/up to \$200\.00/);
  });

  it("lets it through to review, then cancels it if the proof is withdrawn before approval", async () => {
    const r = await requestRelease(ctx, needId, { kind: "final", amountCents: 20000 });
    expect(r.status).toBe("pending_review");
    // The supplier refunded (or the charity disputed) after the request.
    await db().update(proofs).set({ status: "needs_review" }).where(eq(proofs.id, supplierProof));
    await expect(approveRelease({ userId: reviewerId, isDemo: false }, r.releaseId)).rejects.toThrow(/proof changed/);
    const [rel] = await db().select({ status: releases.status }).from(releases).where(eq(releases.id, r.releaseId));
    expect(rel!.status).toBe("rejected");
    const [n] = await db().select({ status: needs.status }).from(needs).where(eq(needs.id, needId));
    expect(n!.status).toBe("open");
  });

  it("flags a need to reviewers when donors were charged more than the supplier payments still standing", async () => {
    const listed = async () => (await listWithdrawnProofNeeds({ userId: reviewerId, isDemo: false })).some((w) => w.needId === needId);
    await db().update(donations).set({ capturedCents: 20000, status: "partially_captured" }).where(eq(donations.needId, needId));
    // Only needs whose final release went through are alerts.
    expect(await listed()).toBe(false);
    await db().insert(releases).values({ needId, charityId: ctx.charityId, kind: "final", amountCents: 20000, status: "completed", requestedBy: ctx.userId });
    expect(await listed()).toBe(true); // supplier proof is in review, so $0 stands against $200 charged
    await db().update(proofs).set({ status: "passed" }).where(eq(proofs.id, supplierProof));
    expect(await listed()).toBe(false);
    // A demo reviewer never sees real charities' needs.
    await db().update(proofs).set({ status: "needs_review" }).where(eq(proofs.id, supplierProof));
    expect((await listWithdrawnProofNeeds({ userId: reviewerId, isDemo: true })).some((w) => w.needId === needId)).toBe(false);
  });

  it("doesn't count a passed proof whose payment was refunded", async () => {
    // The verify-vs-refund race could leave a passed proof on a refunded payment: the rule reads the payment.
    await db().update(proofs).set({ status: "passed" }).where(eq(proofs.id, supplierProof));
    await db().update(supplierPayments).set({ status: "refunded" }).where(eq(supplierPayments.proofId, supplierProof));
    expect((await listWithdrawnProofNeeds({ userId: reviewerId, isDemo: false })).some((w) => w.needId === needId)).toBe(true);
  });

  it("a proof in doubt on the need stops the release skipping review", async () => {
    // Restore a clean state: payment completed, supplier proof passed.
    await db().update(supplierPayments).set({ status: "completed" }).where(eq(supplierPayments.proofId, supplierProof));
    expect(proofChecked((await getReleaseProof(ctx, needId))!)).toBe(true);
    // A recipient said no somewhere on the need.
    await db().insert(proofs).values({ needId, charityId: ctx.charityId, kind: "recipient_confirmation", status: "needs_review", submittedBy: ctx.userId });
    const p = (await getReleaseProof(ctx, needId))!;
    expect(p.openIssues).toBe(1);
    expect(proofChecked(p)).toBe(false);
  });
});
