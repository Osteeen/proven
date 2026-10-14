// Local database. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/needs/repo.db.test.ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, needs } from "@/server/db/schema";
import { MAX_NEEDS_PER_DAY, NeedLimitError, createNeed } from "./repo";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();

run("posting needs (local DB)", () => {
  let charityId = "";
  beforeAll(async () => {
    const [c] = await getDb()
      .insert(charities)
      .values({ name: "Limit test", paypalTrackingId: `limit-${stamp}`, paypalMerchantId: `LIMIT${stamp}`, status: "active" })
      .returning({ id: charities.id });
    charityId = c!.id;
  });
  afterAll(async () => {
    await getDb().delete(needs).where(eq(needs.charityId, charityId));
    await getDb().delete(charities).where(eq(charities.id, charityId));
  });

  it(`stops after ${MAX_NEEDS_PER_DAY} needs in a day`, async () => {
    const ctx = { userId: "x", charityId, charityName: "Limit test", isDemo: false };
    const input = {
      title: "Blankets",
      description: "Blankets for families",
      amountCents: 1000,
      deadline: new Date(Date.now() + 5 * 86400000),
      fundingModel: "reimbursement" as const,
      requiredProof: ["supplier_paypal_payment" as const, "receipt" as const],
    };
    for (let i = 0; i < MAX_NEEDS_PER_DAY; i++) await createNeed(ctx, input);
    await expect(createNeed(ctx, input)).rejects.toBeInstanceOf(NeedLimitError);
  });
});
