// Local database + real Claude API (a few cents). Runs only when asked:
//   RUN_AI_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/proofs/service.live.test.ts
// Creates two throwaway needs (a second charity for the cross-charity duplicate) and removes them after.
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, memberships, needs, proofs, users } from "@/server/db/schema";
import { submitReceipt } from "./service";

const run = process.env.RUN_AI_TESTS === "1" ? describe : describe.skip;
const img = (name: string) => ({ bytes: readFileSync(`scripts/demo/receipts/${name}`) });

run("submitReceipt (local DB + live AI)", () => {
  const db = () => getDb();
  let a: { userId: string; charityId: string; charityName: string; isDemo: boolean };
  let b: typeof a;
  let needA = "";
  let needB = "";
  const made = { charities: [] as string[], users: [] as string[], needs: [] as string[] };

  beforeAll(async () => {
    const mk = async (tag: string) => {
      const [u] = await db().insert(users).values({ id: `live-test-${tag}-${Date.now()}`, email: `live-${tag}-${Date.now()}@proven.test` }).returning({ id: users.id });
      const [c] = await db()
        .insert(charities)
        .values({ name: `Live test ${tag}`, paypalTrackingId: `live-test-${tag}-${Date.now()}`, paypalMerchantId: `LIVETEST${tag}${Date.now()}`, status: "active" })
        .returning({ id: charities.id });
      await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
      const [n] = await db()
        .insert(needs)
        .values({
          charityId: c!.id,
          title: "20 blankets for families at the Riverbend school gym",
          description: "Wool blankets for 20 families sleeping at the school gym after the flood.",
          amountCents: 25000,
          deadline: new Date(Date.now() + 6 * 86400000),
          requiredProof: ["receipt", "supplier_confirmation"],
          status: "open",
          createdAt: new Date(Date.now() - 2 * 86400000),
        })
        .returning({ id: needs.id });
      made.users.push(u!.id);
      made.charities.push(c!.id);
      made.needs.push(n!.id);
      return { ctx: { userId: u!.id, charityId: c!.id, charityName: `Live test ${tag}`, isDemo: false }, needId: n!.id };
    };
    const x = await mk("A");
    const y = await mk("B");
    a = x.ctx;
    b = y.ctx;
    needA = x.needId;
    needB = y.needId;
  });

  afterAll(async () => {
    await db().delete(proofs).where(inArray(proofs.needId, made.needs));
    await db().delete(needs).where(inArray(needs.id, made.needs));
    await db().delete(memberships).where(inArray(memberships.charityId, made.charities));
    await db().delete(charities).where(inArray(charities.id, made.charities));
    for (const id of made.users) await db().delete(users).where(eq(users.id, id));
  });

  it("passes the right receipt", async () => {
    const r = await submitReceipt(a, needA, img("blankets-valley-supply.png"));
    console.log("1", r);
    expect(r.status).toBe("passed");
  }, 120_000);
  it("returns the earlier result when the same photo is uploaded again for the same need", async () => {
    const r = await submitReceipt(a, needA, img("blankets-valley-supply.png"));
    console.log("2", r);
    expect(r.status).toBe("passed");
    expect(r.reasons[0]).toMatch(/already uploaded this receipt/);
  });
  it("fails an unrelated receipt", async () => {
    const r = await submitReceipt(a, needA, img("groceries-cornerstore.png"));
    console.log("3", r);
    expect(r.status).toBe("failed");
  }, 120_000);
  it("flags the same receipt reused by another charity - and the first copy too", async () => {
    const r = await submitReceipt(b, needB, img("blankets-valley-supply.png"));
    console.log("4", r);
    expect(r.status).toBe("needs_review");
    expect(r.reasons[0]).toMatch(/different need/);
    const first = await getDb().select({ status: proofs.status }).from(proofs).where(eq(proofs.needId, needA));
    expect(first.some((p) => p.status === "needs_review")).toBe(true);
  }, 120_000);
  it("still flags the receipt when the shop name is cropped off", async () => {
    const r = await submitReceipt(b, needB, img("blankets-cropped-no-shop.png"));
    console.log("5", r);
    expect(r.status).toBe("needs_review");
  }, 120_000);
  it("refuses a need that belongs to another charity", async () => {
    await expect(submitReceipt(b, needA, img("blankets-valley-supply.png"))).rejects.toThrow(/Need not found/);
  });
});
