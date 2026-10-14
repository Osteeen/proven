// Local database. Runs only when asked:
//   RUN_DB_TESTS=1 node --env-file=.env.local node_modules/.bin/vitest run src/server/proofs/recipients.db.test.ts
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { charities, memberships, messages, needs, proofs, recipientChecks, recipientContacts, supplierPayments, suppliers, users } from "@/server/db/schema";
import { answerRecipient, getRecipientQuestion, recipientCheckSummary, startRecipientCheck } from "./recipients";
import { listProofsForNeed } from "./service";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const stamp = Date.now();
const numbers = (from: number, count: number) => Array.from({ length: count }, (_, i) => `+1555${String(from + i).padStart(7, "0")}`).join("\n");

run("recipient check (local DB)", () => {
  const db = () => getDb();
  type Ctx = { userId: string; charityId: string; charityName: string; isDemo: boolean };
  let a: Ctx & { needId: string };
  let b: Ctx & { needId: string };
  const made = { charities: [] as string[], users: [] as string[], needs: [] as string[], suppliers: [] as string[] };
  let supplierId = "";
  /** The goods were bought through Proven: a completed supplier payment on the need. */
  const buy = (ctx: Ctx, needId: string) =>
    db().insert(supplierPayments).values({ needId, charityId: ctx.charityId, supplierId, amountCents: 10000, description: "Parcels", status: "completed", createdBy: ctx.userId, completedAt: new Date() });

  beforeAll(async () => {
    const mk = async (tag: string) => {
      const [u] = await db().insert(users).values({ id: `rc-${tag}-${stamp}`, email: `rc-${tag}-${stamp}@proven.test` }).returning({ id: users.id });
      const [c] = await db()
        .insert(charities)
        .values({ name: `Recipient test ${tag}`, paypalTrackingId: `rc-${tag}-${stamp}`, paypalMerchantId: `RC${tag}${stamp}`, status: "active" })
        .returning({ id: charities.id });
      await db().insert(memberships).values({ userId: u!.id, charityId: c!.id, role: "charity_admin" });
      const [n] = await db()
        .insert(needs)
        .values({ charityId: c!.id, title: "Food parcels for 40 families", description: "Food parcels", amountCents: 50000, deadline: new Date(Date.now() + 6 * 86400000), requiredProof: ["supplier_paypal_payment", "recipient_confirmation"], status: "open" })
        .returning({ id: needs.id });
      made.users.push(u!.id);
      made.charities.push(c!.id);
      made.needs.push(n!.id);
      return { userId: u!.id, charityId: c!.id, charityName: `Recipient test ${tag}`, isDemo: false, needId: n!.id };
    };
    const [sup] = await db()
      .insert(suppliers)
      .values({ name: "Parcel Supply", paypalEmail: `rc-sup-${stamp}@business.example.com`, paypalTrackingId: `rc-sup-${stamp}`, paypalMerchantId: `RCSUP${stamp}`, status: "connected", connectedAt: new Date(), verifiedAt: new Date() })
      .returning({ id: suppliers.id });
    supplierId = sup!.id;
    made.suppliers.push(supplierId);
    a = await mk("A");
    b = await mk("B");
  });

  afterAll(async () => {
    const checks = await db().select({ id: recipientChecks.id }).from(recipientChecks).where(inArray(recipientChecks.needId, made.needs));
    if (checks.length) await db().delete(recipientContacts).where(inArray(recipientContacts.checkId, checks.map((c) => c.id)));
    await db().delete(recipientChecks).where(inArray(recipientChecks.needId, made.needs));
    await db().delete(proofs).where(inArray(proofs.needId, made.needs));
    await db().delete(supplierPayments).where(inArray(supplierPayments.needId, made.needs));
    await db().delete(suppliers).where(inArray(suppliers.id, made.suppliers));
    await db().delete(messages).where(inArray(messages.charityId, made.charities));
    await db().delete(needs).where(inArray(needs.id, made.needs));
    await db().delete(memberships).where(inArray(memberships.charityId, made.charities));
    await db().delete(charities).where(inArray(charities.id, made.charities));
    for (const id of made.users) await db().delete(users).where(eq(users.id, id));
  });

  const tokens = async (charityId: string) =>
    (await db().select({ body: messages.bodyText }).from(messages).where(and(eq(messages.charityId, charityId), eq(messages.kind, "recipient_check")))).map(
      (m) => m.body!.match(/\/r\/([A-Za-z0-9_-]{43})/)![1]!,
    );
  const proofStatus = async (needId: string) => (await db().select({ s: proofs.status }).from(proofs).where(and(eq(proofs.needId, needId), eq(proofs.kind, "recipient_confirmation"))))[0]?.s;

  it("waits until the supplier has been paid through Proven", async () => {
    await expect(startRecipientCheck(a, a.needId, { numbers: numbers(1, 5), consent: true })).rejects.toThrow(/Pay the supplier/);
    await buy(a, a.needId);
    await buy(b, b.needId);
  });

  it("needs consent and real numbers", async () => {
    await expect(startRecipientCheck(a, a.needId, { numbers: numbers(1, 3), consent: false })).rejects.toThrow(/agreed/);
    await expect(startRecipientCheck(a, a.needId, { numbers: "+1555\nnot a number", consent: true })).rejects.toThrow(/aren't|isn't/);
    // No country code: refused, so one handset can't be written three ways.
    await expect(startRecipientCheck(a, a.needId, { numbers: "5550102233", consent: true })).rejects.toThrow(/isn't/);
  });

  it("won't run on another charity's need", async () => {
    await expect(startRecipientCheck(b, a.needId, { numbers: numbers(1, 3), consent: true })).rejects.toThrow("Need not found.");
  });

  it("texts a random sample, keeps no numbers, and passes once half say yes", async () => {
    const r = await startRecipientCheck(a, a.needId, { numbers: numbers(1000, 40), consent: true });
    expect(r).toEqual({ asked: 4, total: 40 });
    const t = await tokens(a.charityId);
    expect(t).toHaveLength(4);
    // No phone number is stored anywhere: only keyed fingerprints and masked "to" lines.
    const rows = await db().select().from(recipientContacts);
    expect(JSON.stringify(rows)).not.toContain("15550001000");
    const mail = await db().select({ to: messages.toEmail, body: messages.bodyText }).from(messages).where(eq(messages.charityId, a.charityId));
    expect(JSON.stringify(mail)).not.toMatch(/555000\d{4}/);

    expect(await proofStatus(a.needId)).toBe("checking");
    expect((await getRecipientQuestion(t[0]!))?.needTitle).toBe("Food parcels for 40 families");
    expect(await answerRecipient(t[0]!, "yes")).toBe("done");
    expect(await answerRecipient(t[0]!, "no")).toBe("already");
    expect(await proofStatus(a.needId)).toBe("checking");
    expect(await answerRecipient(t[1]!, "yes")).toBe("done");
    expect(await proofStatus(a.needId)).toBe("passed");
    expect(await recipientCheckSummary(a, a.needId)).toEqual({ total: 40, sample: 4, yes: 2, no: 0 });
    // The other charity sees nothing of it.
    expect(await recipientCheckSummary(b, a.needId)).toBeNull();
  });

  it("only once per need", async () => {
    await expect(startRecipientCheck(a, a.needId, { numbers: numbers(1, 3), consent: true })).rejects.toThrow(/already sent/);
  });

  it("a late no sends a passed check to a person", async () => {
    const t = await tokens(a.charityId);
    await answerRecipient(t[2]!, "no");
    expect(await proofStatus(a.needId)).toBe("needs_review");
  });

  it("flags numbers already given on another charity's need, without telling the charity", async () => {
    await startRecipientCheck(b, b.needId, { numbers: numbers(1000, 6), consent: true });
    const [check] = await db().select({ shared: recipientChecks.sharedNumbers }).from(recipientChecks).where(eq(recipientChecks.needId, b.needId));
    expect(check!.shared).toBe(6);
    // Nothing differs while answers come in.
    expect(await proofStatus(b.needId)).toBe("checking");
    for (const t of await tokens(b.charityId)) await answerRecipient(t, "yes");
    const [p] = await db().select({ s: proofs.status, r: proofs.reasons }).from(proofs).where(and(eq(proofs.needId, b.needId), eq(proofs.kind, "recipient_confirmation")));
    expect(p!.s).toBe("needs_review");
    expect(p!.r.join(" ")).not.toMatch(/another charity|shared|also given/);
    // Whoever listed them first is recounted too.
    const [first] = await db().select({ shared: recipientChecks.sharedNumbers }).from(recipientChecks).where(eq(recipientChecks.needId, a.needId));
    expect(first!.shared).toBe(6);
    // Reviewers - only reviewers - see the count.
    const forReviewer = await listProofsForNeed({ userId: a.userId, isDemo: false }, b.needId);
    expect(forReviewer.find((x) => x.kind === "recipient_confirmation")!.reasons.join(" ")).toMatch(/6 of these numbers were also listed/);
  });

  it("keeps demo and real charities' numbers apart", async () => {
    await db().update(charities).set({ isDemo: true }).where(eq(charities.id, b.charityId));
    const [n] = await db()
      .insert(needs)
      .values({ charityId: b.charityId, title: "Demo parcels", description: "Demo", amountCents: 50000, deadline: new Date(Date.now() + 6 * 86400000), requiredProof: ["supplier_paypal_payment", "recipient_confirmation"], status: "open" })
      .returning({ id: needs.id });
    made.needs.push(n!.id);
    await buy(b, n!.id);
    // A's real numbers, entered from the demo pool: no match is ever made.
    await startRecipientCheck({ ...b, isDemo: true }, n!.id, { numbers: numbers(1000, 6), consent: true });
    const [check] = await db().select({ shared: recipientChecks.sharedNumbers }).from(recipientChecks).where(eq(recipientChecks.needId, n!.id));
    expect(check!.shared).toBe(0);
  });
});
