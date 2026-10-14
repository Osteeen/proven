// Local database, no PayPal calls (the test needs have no holds). Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/demo/needs.db.test.ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, needs } from "@/server/db/schema";
import { closeStaleDemoNeeds, refreshDemoNeeds } from "./needs";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();
const DAY = 86_400_000;

run("demo needs (local DB)", () => {
  let charityId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [c] = await getDb()
      .insert(charities)
      .values({ name: "Demo cleanup test", paypalTrackingId: `demo-clean-${stamp}`, paypalMerchantId: `DCLEAN${stamp}`, status: "active", isDemo: true })
      .returning({ id: charities.id });
    charityId = c!.id;
    const mk = async (key: string, v: { createdDaysAgo: number; deadlineDays: number; seed: boolean }) => {
      const created = new Date(Date.now() - v.createdDaysAgo * DAY);
      const [n] = await getDb()
        .insert(needs)
        .values({
          charityId,
          title: `Test ${key}`,
          description: "Cleanup test need",
          amountCents: 1000,
          deadline: new Date(Date.now() + v.deadlineDays * DAY),
          requiredProof: ["supplier_paypal_payment", "receipt"],
          status: "open",
          demoSeed: v.seed,
          createdAt: created,
        })
        .returning({ id: needs.id });
      ids[key] = n!.id;
    };
    await mk("visitorOld", { createdDaysAgo: 3, deadlineDays: 10, seed: false });
    await mk("visitorNew", { createdDaysAgo: 0.5, deadlineDays: 10, seed: false });
    await mk("seedLive", { createdDaysAgo: 5, deadlineDays: 10, seed: true });
    await mk("seedOverdue", { createdDaysAgo: 20, deadlineDays: -1, seed: true });
  });

  afterAll(async () => {
    await getDb().delete(needs).where(eq(needs.charityId, charityId));
    await getDb().delete(charities).where(eq(charities.id, charityId));
  });

  const status = async (key: string) => (await getDb().select({ s: needs.status }).from(needs).where(eq(needs.id, ids[key]!)))[0]!.s;

  it("clears visitors' needs after two days and seeded needs past their deadline, nothing else", async () => {
    expect(await closeStaleDemoNeeds(charityId)).toBe(2);
    expect(await status("visitorOld")).toBe("cancelled");
    expect(await status("seedOverdue")).toBe("cancelled");
    expect(await status("visitorNew")).toBe("open");
    expect(await status("seedLive")).toBe("open");
  });

  it("tops the seeded needs up without duplicating them", async () => {
    await refreshDemoNeeds();
    expect(await refreshDemoNeeds()).toBe(0);
  });
});
