// Local database, PayPal mocked. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/suppliers/service.db.test.ts
// Creates two throwaway charities, needs and suppliers and removes them after.
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, memberships, messages, needs, proofs, supplierConfirmations, supplierPayments, suppliers, users } from "@/server/db/schema";

type Order = { status: string; payerId: string; payeeMerchantId: string; referenceId: string; amountValue: string; capture: null | { id: string; status: string } };
const paypal = vi.hoisted(() => ({
  orders: {} as Record<string, Order>,
  captures: 0,
  connected: null as null | {
    merchantId: string;
    paymentsReceivable: boolean;
    primaryEmail: string | null;
    primaryEmailConfirmed: boolean;
    legalName: string | null;
    country: string | null;
  },
}));
vi.mock("@/server/paypal/suppliers", () => ({
  createSupplierConnectLink: async () => "https://sandbox.paypal.com/connect",
  connectedMerchant: async () => paypal.connected,
  createSupplierPaymentOrder: async ({ paymentId }: { paymentId: string }) => ({ orderId: `ORDER-${paymentId}`, approveUrl: "https://sandbox.paypal.com/approve" }),
  getSupplierPaymentOrder: async (orderId: string) => ({ ...paypal.orders[orderId]! }),
  captureSupplierPaymentOrder: async (orderId: string) => {
    // Like PayPal: a second capture of the same order returns the first one.
    const o = paypal.orders[orderId]!;
    if (!o.capture) {
      paypal.captures++;
      await new Promise((r) => setTimeout(r, 20));
      o.capture = { id: `CAP-${orderId}`, status: "COMPLETED" };
      o.status = "COMPLETED";
    }
    return { status: o.status, capture: o.capture };
  },
  supplierCaptureStatus: async () => "COMPLETED",
}));

const {
  cancelSupplierPayment,
  completeSupplierPayment,
  listSuppliersForCharity,
  markSupplierPaymentDisputed,
  markSupplierPaymentUndone,
  refreshSupplier,
  rejectSupplier,
  revokeSupplier,
  startSupplierPayment,
  sweepSupplierPayments,
  verifySupplier,
} = await import("./service");

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();

run("supplier payments (local DB, PayPal mocked)", () => {
  const db = () => getDb();
  type Ctx = { userId: string; charityId: string; charityName: string; isDemo: boolean };
  let a: Ctx & { merchantId: string; needId: string };
  let b: Ctx & { merchantId: string; needId: string };
  let connected = "";
  let invited = "";
  const made = { charities: [] as string[], users: [] as string[], needs: [] as string[], suppliers: [] as string[] };

  beforeAll(async () => {
    const mk = async (tag: string) => {
      const merchantId = `DBTEST${tag}${stamp}`;
      const [u] = await db().insert(users).values({ id: `db-test-${tag}-${stamp}`, email: `db-${tag}-${stamp}@proven.test` }).returning({ id: users.id });
      const [c] = await db()
        .insert(charities)
        .values({ name: `DB test ${tag}`, paypalTrackingId: `db-test-${tag}-${stamp}`, paypalMerchantId: merchantId, status: "active" })
        .returning({ id: charities.id });
      await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
      const [n] = await db()
        .insert(needs)
        .values({
          charityId: c!.id,
          title: "20 blankets for families at the school gym",
          description: "Wool blankets for 20 families after the flood.",
          amountCents: 25000,
          deadline: new Date(Date.now() + 6 * 86400000),
          requiredProof: ["supplier_paypal_payment", "receipt"],
          status: "open",
        })
        .returning({ id: needs.id });
      made.users.push(u!.id);
      made.charities.push(c!.id);
      made.needs.push(n!.id);
      return { userId: u!.id, charityId: c!.id, charityName: `DB test ${tag}`, isDemo: false, merchantId, needId: n!.id };
    };
    a = await mk("A");
    b = await mk("B");
    const [s1] = await db()
      .insert(suppliers)
      .values({ name: "Test Supply", paypalEmail: `supply-${stamp}@business.example.com`, paypalTrackingId: `db-sup-1-${stamp}`, paypalMerchantId: `SUP${stamp}`, status: "connected", invitedByCharityId: a.charityId, connectedAt: new Date(), verifiedAt: new Date() })
      .returning({ id: suppliers.id });
    const [s2] = await db()
      .insert(suppliers)
      .values({ name: "Not Yet Supply", paypalEmail: `notyet-${stamp}@business.example.com`, paypalTrackingId: `db-sup-2-${stamp}`, invitedByCharityId: a.charityId })
      .returning({ id: suppliers.id });
    connected = s1!.id;
    invited = s2!.id;
    made.suppliers.push(connected, invited);
  });

  afterAll(async () => {
    await db().update(supplierConfirmations).set({ proofId: null }).where(inArray(supplierConfirmations.needId, made.needs));
    await db().delete(supplierConfirmations).where(inArray(supplierConfirmations.needId, made.needs));
    await db().delete(messages).where(inArray(messages.charityId, made.charities));
    await db().update(supplierPayments).set({ proofId: null }).where(inArray(supplierPayments.needId, made.needs));
    await db().delete(proofs).where(inArray(proofs.needId, made.needs));
    await db().delete(supplierPayments).where(inArray(supplierPayments.needId, made.needs));
    await db().delete(suppliers).where(inArray(suppliers.id, made.suppliers));
    await db().delete(needs).where(inArray(needs.id, made.needs));
    await db().delete(memberships).where(inArray(memberships.charityId, made.charities));
    await db().delete(charities).where(inArray(charities.id, made.charities));
    for (const id of made.users) await db().delete(users).where(eq(users.id, id));
  });

  beforeEach(() => {
    paypal.captures = 0;
  });

  const approved = (paymentId: string, over: Partial<Order> = {}) => {
    paypal.orders[`ORDER-${paymentId}`] = { status: "APPROVED", payerId: a.merchantId, payeeMerchantId: `SUP${stamp}`, referenceId: paymentId, amountValue: "100.00", capture: null, ...over };
  };
  const freshNeed = async () => {
    const [n] = await db()
      .insert(needs)
      .values({ charityId: a.charityId, title: "Extra need", description: "Extra", amountCents: 25000, deadline: new Date(Date.now() + 6 * 86400000), requiredProof: ["supplier_paypal_payment", "receipt"], status: "open" })
      .returning({ id: needs.id });
    made.needs.push(n!.id);
    return n!.id;
  };
  const start = async (amount = "100.00", needId = a.needId) => {
    await startSupplierPayment(a, needId, { supplierId: connected, amount, description: "Blankets" });
    const [p] = await db()
      .select({ id: supplierPayments.id })
      .from(supplierPayments)
      .where(and(eq(supplierPayments.needId, needId), eq(supplierPayments.status, "created")))
      .orderBy(desc(supplierPayments.createdAt))
      .limit(1);
    return p!.id;
  };

  it("refuses to pay from another charity's need", async () => {
    await expect(startSupplierPayment(b, a.needId, { supplierId: connected, amount: "10", description: "Blankets" })).rejects.toThrow("Need not found.");
  });

  it("refuses a supplier that hasn't connected PayPal", async () => {
    await expect(startSupplierPayment(a, a.needId, { supplierId: invited, amount: "10", description: "Blankets" })).rejects.toThrow(/hasn't connected PayPal/);
  });

  it("refuses more than the need costs", async () => {
    await expect(startSupplierPayment(a, a.needId, { supplierId: connected, amount: "250.01", description: "Blankets" })).rejects.toThrow(/can't go over/);
  });

  it("won't finish another charity's payment", async () => {
    const id = await start();
    approved(id);
    const r = await completeSupplierPayment(b, id);
    expect(r.status).toBe("failed");
    expect(r.needId).toBeNull();
    expect(paypal.captures).toBe(0);
    await db().update(supplierPayments).set({ status: "cancelled" }).where(eq(supplierPayments.id, id));
  });

  it.each([
    ["approved from someone else's PayPal", { payerId: "SOMEONEELSE" }, /isn't your charity's/],
    ["paid to a different account", { payeeMerchantId: "OTHERPAYEE" }, /details didn't match/],
    ["a different amount", { amountValue: "99.00" }, /amount didn't match/],
  ])("refuses a payment %s", async (_label, over, msg) => {
    const id = await start();
    approved(id, over);
    const r = await completeSupplierPayment(a, id);
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(msg);
    expect(paypal.captures).toBe(0);
    const ps = await db().select().from(proofs).where(eq(proofs.needId, a.needId));
    expect(ps).toHaveLength(0);
  });

  it("takes an approved payment once and records a passed proof", async () => {
    const id = await start();
    approved(id);
    const r1 = await completeSupplierPayment(a, id);
    expect(r1.status).toBe("completed");
    const r2 = await completeSupplierPayment(a, id);
    expect(r2.status).toBe("completed");
    expect(paypal.captures).toBe(1);
    const ps = await db().select().from(proofs).where(eq(proofs.needId, a.needId));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: "supplier_paypal_payment", status: "passed", amountCents: 10000 });
  });

  it("won't capture past the need's cost when an old unfinished payment is approved late", async () => {
    // 100 paid. Start 150 (fills it), then pretend it went stale and another 150 started and was paid.
    const late = await start("150.00");
    await db().update(supplierPayments).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(supplierPayments.id, late));
    const other = await start("150.00");
    approved(other, { amountValue: "150.00" });
    expect((await completeSupplierPayment(a, other)).status).toBe("completed");
    approved(late, { amountValue: "150.00" });
    const r = await completeSupplierPayment(a, late);
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/can't go over/);
    expect(paypal.captures).toBe(1);
  });

  it("two completions at once can't both fit under the cost", async () => {
    // A second need so earlier payments don't matter: cost 250, two approved payments of 150 each.
    const needId = await freshNeed();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = await start("150.00", needId);
      ids.push(id);
      // Make it stale so the next one may start.
      await db().update(supplierPayments).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(supplierPayments.id, id));
    }
    for (const id of ids) approved(id, { amountValue: "150.00" });
    const results = await Promise.all(ids.map((id) => completeSupplierPayment(a, id)));
    expect(results.map((r) => r.status).sort()).toEqual(["completed", "failed"]);
    expect(paypal.captures).toBe(1);
  });

  it("won't cancel a payment PayPal shows as approved", async () => {
    const id = await start("1.00", await freshNeed());
    approved(id, { amountValue: "1.00" });
    await cancelSupplierPayment(a, id);
    const [row] = await db().select({ status: supplierPayments.status }).from(supplierPayments).where(eq(supplierPayments.id, id));
    expect(row!.status).toBe("created");
    paypal.orders[`ORDER-${id}`]!.status = "PAYER_ACTION_REQUIRED";
    await cancelSupplierPayment(a, id);
    const [after] = await db().select({ status: supplierPayments.status }).from(supplierPayments).where(eq(supplierPayments.id, id));
    expect(after!.status).toBe("cancelled");
  });

  it("the daily sweep records a capture whose answer was lost", async () => {
    const id = await start("1.00", await freshNeed());
    approved(id, { amountValue: "1.00", status: "COMPLETED", capture: { id: `CAP-LOST-${stamp}`, status: "COMPLETED" } });
    await db()
      .update(supplierPayments)
      .set({ captureRequestedAt: new Date(), createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(supplierPayments.id, id));
    await sweepSupplierPayments();
    const [row] = await db().select({ status: supplierPayments.status, proofId: supplierPayments.proofId }).from(supplierPayments).where(eq(supplierPayments.id, id));
    expect(row!.status).toBe("completed");
    expect(row!.proofId).not.toBeNull();
    expect(paypal.captures).toBe(0);
  });

  it("sends the proof to a person when the supplier refunds", async () => {
    const [p] = await db()
      .select({ captureId: supplierPayments.paypalCaptureId, proofId: supplierPayments.proofId })
      .from(supplierPayments)
      .where(and(eq(supplierPayments.needId, a.needId), eq(supplierPayments.status, "completed")))
      .limit(1);
    expect(await markSupplierPaymentUndone(p!.captureId!, "refunded")).toBe(true);
    expect(await markSupplierPaymentUndone(p!.captureId!, "refunded")).toBe(false);
    const [proof] = await db().select({ status: proofs.status }).from(proofs).where(eq(proofs.id, p!.proofId!));
    expect(proof!.status).toBe("needs_review");
  });

  it("refuses a supplier that connects with a charity's own PayPal account", async () => {
    paypal.connected = { merchantId: b.merchantId, paymentsReceivable: true, primaryEmail: `notyet-${stamp}@business.example.com`, primaryEmailConfirmed: true, legalName: null, country: null };
    expect(await refreshSupplier(invited)).toBe("invited");
  });

  it("refuses a supplier that connects with a different PayPal account than invited", async () => {
    paypal.connected = { merchantId: `NEW${stamp}`, paymentsReceivable: true, primaryEmail: "someone-else@business.example.com", primaryEmailConfirmed: true, legalName: null, country: null };
    expect(await refreshSupplier(invited)).toBe("invited");
  });

  it("refuses a connection when PayPal gives no confirmed email", async () => {
    paypal.connected = { merchantId: `NEW${stamp}`, paymentsReceivable: true, primaryEmail: null, primaryEmailConfirmed: false, legalName: null, country: null };
    expect(await refreshSupplier(invited)).toBe("invited");
    paypal.connected = { merchantId: `NEW${stamp}`, paymentsReceivable: true, primaryEmail: `notyet-${stamp}@business.example.com`, primaryEmailConfirmed: false, legalName: null, country: null };
    expect(await refreshSupplier(invited)).toBe("invited");
  });

  it("shows a supplier's email only to the charity that invited it", async () => {
    const forA = await listSuppliersForCharity(a);
    const forB = await listSuppliersForCharity(b);
    expect(forA.find((s) => s.id === connected)?.email).toBe(`supply-${stamp}@business.example.com`);
    expect(forB.find((s) => s.id === connected)?.email).toBeNull();
    // An invited (not connected) supplier is visible only to its inviter.
    expect(forB.find((s) => s.id === invited)).toBeUndefined();
  });

  it("connects a supplier once PayPal confirms the invited account", async () => {
    paypal.connected = {
      merchantId: `NEW${stamp}`,
      paymentsReceivable: true,
      primaryEmail: `notyet-${stamp}@business.example.com`,
      primaryEmailConfirmed: true,
      legalName: "Some Other Name LLC",
      country: "US",
    };
    expect(await refreshSupplier(invited)).toBe("connected");
    const [row] = await db().select({ legal: suppliers.paypalLegalName }).from(suppliers).where(eq(suppliers.id, invited));
    expect(row!.legal).toBe("Some Other Name LLC");
  });

  it("keeps an unverified supplier private to the charity that invited it", async () => {
    expect((await listSuppliersForCharity(b)).find((s) => s.id === invited)).toBeUndefined();
    await expect(startSupplierPayment(b, b.needId, { supplierId: invited, amount: "10", description: "Blankets" })).rejects.toThrow("Supplier not found.");
  });

  it("sends payments to an unverified supplier to review, and passes them once a reviewer verifies it", async () => {
    const needId = await freshNeed();
    await startSupplierPayment(a, needId, { supplierId: invited, amount: "20.00", description: "Tarps" });
    const [p] = await db().select({ id: supplierPayments.id }).from(supplierPayments).where(eq(supplierPayments.needId, needId));
    paypal.orders[`ORDER-${p!.id}`] = { status: "APPROVED", payerId: a.merchantId, payeeMerchantId: `NEW${stamp}`, referenceId: p!.id, amountValue: "20.00", capture: null };
    expect((await completeSupplierPayment(a, p!.id)).status).toBe("completed");
    const proof = async () => (await db().select({ status: proofs.status }).from(proofs).where(eq(proofs.needId, needId)))[0]!.status;
    expect(await proof()).toBe("needs_review");

    // A demo reviewer can't verify a real supplier.
    await expect(verifySupplier({ userId: a.userId, isDemo: true }, invited)).rejects.toThrow(/isn't yours to review/);
    await verifySupplier({ userId: a.userId, isDemo: false }, invited);
    expect(await proof()).toBe("passed");
    expect((await listSuppliersForCharity(b)).find((s) => s.id === invited)?.verified).toBe(true);
  });

  it("fails proofs from a rejected supplier and stops new payments to it", async () => {
    const [s3] = await db()
      .insert(suppliers)
      .values({ name: "Sock Puppet", paypalEmail: `puppet-${stamp}@business.example.com`, paypalTrackingId: `db-sup-3-${stamp}`, paypalMerchantId: `PUP${stamp}`, status: "connected", invitedByCharityId: a.charityId, connectedAt: new Date() })
      .returning({ id: suppliers.id });
    made.suppliers.push(s3!.id);
    const needId = await freshNeed();
    await startSupplierPayment(a, needId, { supplierId: s3!.id, amount: "30.00", description: "Water" });
    const [p] = await db().select({ id: supplierPayments.id }).from(supplierPayments).where(eq(supplierPayments.needId, needId));
    paypal.orders[`ORDER-${p!.id}`] = { status: "APPROVED", payerId: a.merchantId, payeeMerchantId: `PUP${stamp}`, referenceId: p!.id, amountValue: "30.00", capture: null };
    await completeSupplierPayment(a, p!.id);
    await rejectSupplier({ userId: a.userId, isDemo: false }, s3!.id);
    const [proof] = await db().select({ status: proofs.status }).from(proofs).where(eq(proofs.needId, needId));
    expect(proof!.status).toBe("failed");
    await expect(startSupplierPayment(a, needId, { supplierId: s3!.id, amount: "5", description: "Water" })).rejects.toThrow(/can't be paid/);
  });

  it("sends a proof to review when the charity disputes the payment", async () => {
    const [p] = await db()
      .select({ captureId: supplierPayments.paypalCaptureId, proofId: supplierPayments.proofId })
      .from(supplierPayments)
      .innerJoin(proofs, eq(proofs.id, supplierPayments.proofId))
      .where(and(eq(supplierPayments.charityId, a.charityId), eq(supplierPayments.status, "completed"), eq(proofs.status, "passed")))
      .limit(1);
    expect(await markSupplierPaymentDisputed(p!.captureId!)).toBe(true);
    expect(await markSupplierPaymentDisputed(p!.captureId!)).toBe(false);
    const [proof] = await db().select({ status: proofs.status }).from(proofs).where(eq(proofs.id, p!.proofId!));
    expect(proof!.status).toBe("needs_review");
  });

  it("revoking a verified supplier fails every proof resting on it and stops new payments", async () => {
    // A demo reviewer can't touch a real supplier.
    await expect(revokeSupplier({ userId: a.userId, isDemo: true }, connected)).rejects.toThrow(/isn't yours/);
    await revokeSupplier({ userId: a.userId, isDemo: false }, connected);
    const rows = await db()
      .select({ status: proofs.status })
      .from(proofs)
      .innerJoin(supplierPayments, eq(supplierPayments.proofId, proofs.id))
      .where(eq(supplierPayments.supplierId, connected));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "failed")).toBe(true);
    await expect(startSupplierPayment(a, await freshNeed(), { supplierId: connected, amount: "5", description: "More" })).rejects.toThrow(/can't be paid/);
    // Revoking twice is refused, not repeated.
    await expect(revokeSupplier({ userId: a.userId, isDemo: false }, connected)).rejects.toThrow();
  });
});
