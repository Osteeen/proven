// Local database, no PayPal calls (the test needs have no holds). Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/demo/needs.db.test.ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { randomUUID } from "node:crypto";
import { charities, donations, needs } from "@/server/db/schema";
import templates from "./demo-needs.json";
import { closeStaleDemoNeeds, extendDemoDeadlines, refreshDemoNeeds } from "./needs";

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
    const mk = async (key: string, v: { createdDaysAgo: number; deadlineDays: number; seed: boolean; title?: string }) => {
      const created = new Date(Date.now() - v.createdDaysAgo * DAY);
      const [n] = await getDb()
        .insert(needs)
        .values({
          charityId,
          title: v.title ?? `Test ${key}`,
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
    await mk("seedLive", { createdDaysAgo: 5, deadlineDays: 10, seed: true, title: templates[0]!.title });
    await mk("seedRetired", { createdDaysAgo: 5, deadlineDays: 10, seed: true });
    await mk("seedOverdue", { createdDaysAgo: 20, deadlineDays: -1, seed: true });
    // Near the end of its 28-day window: can only move to created + 28 days.
    await mk("seedCapped", { createdDaysAgo: 25, deadlineDays: 1, seed: true, title: templates[1]!.title });
    // Two copies of one template, no money on either: the older one goes.
    await mk("dupOld", { createdDaysAgo: 3, deadlineDays: 5, seed: true, title: templates[2]!.title });
    await mk("dupNew", { createdDaysAgo: 1, deadlineDays: 9, seed: true, title: templates[2]!.title });
    // Money on hold that lapses in 8 days: the deadline can only move to a day before that.
    await mk("seedHeld", { createdDaysAgo: 2, deadlineDays: 5, seed: true, title: templates[3]!.title });
    await getDb().insert(donations).values({
      needId: ids.seedHeld!,
      charityId,
      amountCents: 1000,
      createRequestId: randomUUID(),
      donorAccessHash: `test-${stamp}`,
      status: "authorized",
      authorizedAt: new Date(Date.now() - 21 * DAY),
      holdExpiresAt: new Date(Date.now() + 8 * DAY),
    });
  });

  afterAll(async () => {
    await getDb().delete(donations).where(eq(donations.charityId, charityId));
    await getDb().delete(needs).where(eq(needs.charityId, charityId));
    await getDb().delete(charities).where(eq(charities.id, charityId));
  });

  const status = async (key: string) => (await getDb().select({ s: needs.status }).from(needs).where(eq(needs.id, ids[key]!)))[0]!.s;

  const deadline = async (key: string) => (await getDb().select({ d: needs.deadline }).from(needs).where(eq(needs.id, ids[key]!)))[0]!.d;

  it("rolls seeded deadlines forward, inside the 28-day window, and leaves other needs alone", async () => {
    const before = await deadline("visitorNew");
    expect(await extendDemoDeadlines(charityId)).toBe(5); // seedLive, seedCapped, dupOld, dupNew, seedHeld
    const live = (await deadline("seedLive")).getTime();
    expect(live).toBeGreaterThan(Date.now() + (templates[0]!.days - 1) * DAY);
    expect(live).toBeLessThanOrEqual(Date.now() + (templates[0]!.days + 1) * DAY);
    const capped = (await deadline("seedCapped")).getTime();
    expect(Math.abs(capped - (Date.now() + 3 * DAY))).toBeLessThan(60_000);
    const held = (await deadline("seedHeld")).getTime();
    expect(Math.abs(held - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
    expect((await deadline("visitorNew")).getTime()).toBe(before.getTime());
    // Already as far as it can go: nothing moves on a second run the same day.
    expect(await extendDemoDeadlines(charityId)).toBe(0);
  });

  it("clears visitors' needs after two days, seeded needs past their deadline, retired seeds and duplicates, nothing else", async () => {
    expect(await closeStaleDemoNeeds(charityId)).toBe(4);
    expect(await status("dupOld")).toBe("cancelled");
    expect(await status("dupNew")).toBe("open");
    expect(await status("seedCapped")).toBe("open");
    expect(await status("seedHeld")).toBe("open");
    expect(await status("visitorOld")).toBe("cancelled");
    expect(await status("seedOverdue")).toBe("cancelled");
    // Its template was replaced in demo-needs.json.
    expect(await status("seedRetired")).toBe("cancelled");
    expect(await status("visitorNew")).toBe("open");
    expect(await status("seedLive")).toBe("open");
  });

  it("tops the seeded needs up without duplicating them", async () => {
    await refreshDemoNeeds();
    expect(await refreshDemoNeeds()).toBe(0);
  });
});
