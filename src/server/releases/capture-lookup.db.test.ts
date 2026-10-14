// Local database, PayPal mocked. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/releases/capture-lookup.db.test.ts
// A capture PayPal refuses outright is checked against PayPal's own record before it is called failed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { captures, charities, donations, memberships, needs, releases, users } from "@/server/db/schema";
import { PayPalError } from "@/server/paypal/client";

const paypal = vi.hoisted(() => ({
  // What PayPal's order record shows after the refusal.
  record: "none" as "took" | "none" | "otherAmount" | "unreachable",
  invoices: [] as string[],
  captureCalls: 0,
}));
vi.mock("@/server/paypal/orders", () => ({
  // PayPal answers the capture with a plain refusal...
  captureAuthorization: async (_auth: string, _cents: number, _final: boolean, _req: string, invoiceId: string) => {
    paypal.captureCalls++;
    paypal.invoices.push(invoiceId);
    throw new PayPalError(422, "UNPROCESSABLE_ENTITY", ["AUTHORIZATION_EXPIRED"], null);
  },
  // ...while its order record may show the money was taken anyway.
  getOrderCaptures: async () => {
    if (paypal.record === "unreachable") throw new Error("PayPal timed out");
    if (paypal.record === "none") return [];
    const value = paypal.record === "otherAmount" ? "11.50" : "10.00";
    // A declined attempt listed first must not hide the completed one.
    return paypal.invoices.flatMap((inv) => [
      { id: `CAP-DECLINED-${inv}`, status: "DECLINED", invoiceId: inv, amountValue: value },
      { id: `CAP-LOOKUP-${inv}`, status: "COMPLETED", invoiceId: inv, amountValue: value },
    ]);
  },
  getOrderPayments: async () => ({ captures: [], refunds: [] }),
  voidAuthorization: async () => undefined,
  reauthorizeAuthorization: async () => {
    throw new Error("not expected");
  },
}));

const { executeRelease } = await import("./service");

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();

run("capture refused by PayPal (local DB, PayPal mocked)", () => {
  const db = () => getDb();
  let charityId = "";
  let userId = "";
  const needIds: string[] = [];

  beforeAll(async () => {
    const [u] = await db().insert(users).values({ id: `lookup-${stamp}`, email: `lookup-${stamp}@proven.test` }).returning({ id: users.id });
    const [c] = await db()
      .insert(charities)
      .values({ name: "Lookup test", paypalTrackingId: `lookup-${stamp}`, paypalMerchantId: `LOOKUP${stamp}`, status: "active" })
      .returning({ id: charities.id });
    await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
    userId = u!.id;
    charityId = c!.id;
  });

  afterAll(async () => {
    // The ledger is append-only (a database trigger refuses deletes), so the rows this test
    // wrote stay; the throwaway charity is suspended, which keeps it out of every list.
    await db().update(charities).set({ status: "suspended" }).where(eq(charities.id, charityId));
  });

  /** A need with one $10 hold inside its honor period and an approved $10 final release. */
  const setup = async () => {
    const [n] = await db()
      .insert(needs)
      .values({ charityId, title: "Lookup need", description: "Lookup", amountCents: 1000, deadline: new Date(Date.now() + 5 * 86400000), requiredProof: ["receipt", "supplier_confirmation"], status: "in_review" })
      .returning({ id: needs.id });
    needIds.push(n!.id);
    const tag = randomUUID().slice(0, 8);
    const [d] = await db()
      .insert(donations)
      .values({
        needId: n!.id,
        charityId,
        amountCents: 1000,
        createRequestId: randomUUID(),
        donorAccessHash: `lookup-${tag}`,
        status: "authorized",
        paypalOrderId: `ORDER-${tag}`,
        paypalAuthorizationId: `AUTH-${tag}`,
        authorizedAt: new Date(),
        honorPeriodEndsAt: new Date(Date.now() + 2 * 86400000),
      })
      .returning({ id: donations.id });
    const [r] = await db()
      .insert(releases)
      .values({ needId: n!.id, charityId, kind: "final", amountCents: 1000, status: "approved", requestedBy: userId })
      .returning({ id: releases.id });
    return { needId: n!.id, donationId: d!.id, releaseId: r!.id };
  };

  const reset = (record: typeof paypal.record) => {
    paypal.record = record;
    paypal.invoices = [];
    paypal.captureCalls = 0;
  };
  const shareStatus = async (releaseId: string) => (await db().select({ status: captures.status }).from(captures).where(eq(captures.releaseId, releaseId)))[0]!.status;

  it("records the share as paid when PayPal's record shows it took the money", async () => {
    reset("took");
    const s = await setup();
    expect(await executeRelease(s.releaseId)).toBe("completed");
    const [cap] = await db().select({ status: captures.status, paypalCaptureId: captures.paypalCaptureId }).from(captures).where(eq(captures.releaseId, s.releaseId));
    expect(cap).toMatchObject({ status: "completed" });
    expect(cap!.paypalCaptureId).toMatch(/^CAP-LOOKUP-/);
    const [don] = await db().select({ captured: donations.capturedCents }).from(donations).where(eq(donations.id, s.donationId));
    expect(don!.captured).toBe(1000);
  });

  it("marks it failed only when PayPal's record shows nothing was taken", async () => {
    reset("none");
    const s = await setup();
    expect(await executeRelease(s.releaseId)).toBe("failed");
    const [cap] = await db().select({ status: captures.status }).from(captures).where(eq(captures.releaseId, s.releaseId));
    expect(cap!.status).toBe("failed");
    const [don] = await db().select({ captured: donations.capturedCents }).from(donations).where(eq(donations.id, s.donationId));
    expect(don!.captured).toBe(0);
  });

  it("never books a capture whose amount differs from ours - and never calls it failed or captures again", async () => {
    reset("otherAmount");
    const s = await setup();
    expect(await executeRelease(s.releaseId)).toBe("failed");
    expect(await shareStatus(s.releaseId)).toBe("pending");
    const [don] = await db().select({ captured: donations.capturedCents }).from(donations).where(eq(donations.id, s.donationId));
    expect(don!.captured).toBe(0);
    // A reviewer's retry looks first and stops: no second capture call.
    expect(await executeRelease(s.releaseId, { allowStuck: true })).toBe("failed");
    expect(paypal.captureCalls).toBe(1);
  });

  it("leaves the share open when PayPal can't be reached to check", async () => {
    reset("unreachable");
    const s = await setup();
    expect(await executeRelease(s.releaseId)).toBe("failed");
    expect(await shareStatus(s.releaseId)).toBe("pending");
  });
});
