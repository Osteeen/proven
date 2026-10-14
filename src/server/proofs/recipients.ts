import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { appUrl } from "@/server/app-url";
import type { CharityContext } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { charities, needs, proofs, recipientChecks, recipientContacts, supplierPayments } from "@/server/db/schema";
import { sendMail } from "@/server/mail/mailer";
import { maskPhone, parseRecipients, recipientStatus, sampleSize } from "./recipient-rules";

export class RecipientCheckError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const OPEN_FOR_PROOF = ["open", "funded", "delivering", "in_review"];
const VALID_MS = 14 * 86_400_000;
const MAX_CHECKS_PER_DAY = 5;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Keyed fingerprint of a number: the same number matches across needs, but a list
 * of every phone number can't reverse it without the key. RECIPIENT_HMAC_KEY is
 * its own secret (required in production, checked at startup); local development
 * without it falls back to a key derived from AUTH_SECRET.
 */
function phoneKey(n: string): string {
  const own = process.env.RECIPIENT_HMAC_KEY;
  let key: Buffer;
  if (own && own.length >= 32) key = Buffer.from(own);
  else {
    const secret = process.env.AUTH_SECRET;
    if (process.env.NODE_ENV === "production" || !secret || secret.length < 32) throw new Error("RECIPIENT_HMAC_KEY is not set");
    key = createHash("sha256").update(`proven-recipient-phone:${secret}`).digest();
  }
  return createHmac("sha256", key).update(n).digest("hex");
}

/** Picks `k` of `items` uniformly at random (crypto randomness, so the charity can't predict who is asked). */
function pick<T>(items: T[], k: number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, k);
}

/**
 * After delivery, the charity enters the numbers it recorded at intake. Proven
 * picks the sample and texts each a one-tap question. The numbers themselves are
 * dropped as soon as the texts are written: only keyed fingerprints are kept.
 */
export async function startRecipientCheck(ctx: CharityContext, needId: string, input: { numbers: string; consent: boolean }): Promise<{ asked: number; total: number }> {
  if (!UUID.test(needId)) throw new RecipientCheckError("Need not found.");
  if (!input.consent) throw new RecipientCheckError("Confirm the people helped agreed to be contacted once.");
  const parsed = parseRecipients(input.numbers);
  if (parsed.tooMany) throw new RecipientCheckError("Enter up to 1,000 numbers.");
  if (parsed.invalid > 0) throw new RecipientCheckError(`${parsed.invalid} ${parsed.invalid === 1 ? "line isn't" : "lines aren't"} a phone number. Put one number per line, with the country code.`);
  if (parsed.numbers.length === 0) throw new RecipientCheckError("Enter the phone numbers you recorded when handing out the goods.");

  const db = getDb();
  const keyed = parsed.numbers.map((n) => ({ n, key: phoneKey(n) }));
  const k = sampleSize(keyed.length);
  const sampled = new Set(pick(keyed, k).map((x) => x.key));

  const texts: { to: string; token: string }[] = [];
  const sent = await db.transaction(async (tx) => {
    const [need] = await tx
      .select({
        id: needs.id,
        title: needs.title,
        status: needs.status,
        requiredProof: needs.requiredProof,
        charityName: charities.name,
        charityStatus: charities.status,
        isDemo: charities.isDemo,
      })
      .from(needs)
      .innerJoin(charities, eq(charities.id, needs.charityId))
      .where(and(eq(needs.id, needId), eq(needs.charityId, ctx.charityId)))
      .for("update", { of: needs });
    if (!need) throw new RecipientCheckError("Need not found.");
    if (need.charityStatus !== "active") throw new RecipientCheckError("Your charity's account is on hold. Contact Proven.");
    if (!OPEN_FOR_PROOF.includes(need.status)) throw new RecipientCheckError("This need is closed - no more proof can be added.");
    if (!need.requiredProof.includes("recipient_confirmation")) throw new RecipientCheckError("This need doesn't use a recipient check.");
    const [already] = await tx.select({ id: recipientChecks.id }).from(recipientChecks).where(eq(recipientChecks.needId, need.id)).limit(1);
    if (already) throw new RecipientCheckError("The recipient check for this need was already sent.");
    // Delivery comes after buying: on a need bought through Proven, the supplier must have been paid first.
    if (need.requiredProof.includes("supplier_paypal_payment")) {
      const [bought] = await tx
        .select({ id: supplierPayments.id })
        .from(supplierPayments)
        .where(and(eq(supplierPayments.needId, need.id), eq(supplierPayments.status, "completed")))
        .limit(1);
      if (!bought) throw new RecipientCheckError("Pay the supplier with PayPal first - the recipient check comes after the goods are handed out.");
    }
    const [{ today = 0 } = {}] = await tx
      .select({ today: sql<number>`count(*)::int` })
      .from(recipientChecks)
      .where(and(eq(recipientChecks.charityId, ctx.charityId), gt(recipientChecks.createdAt, new Date(Date.now() - 86_400_000))));
    if (today >= MAX_CHECKS_PER_DAY) throw new RecipientCheckError("You've sent several recipient checks today. Try again tomorrow.");

    // The same people can't stand behind two charities' deliveries unnoticed.
    const [{ shared = 0 } = {}] = await tx
      .select({ shared: sql<number>`count(distinct ${recipientContacts.phoneKey})::int` })
      .from(recipientContacts)
      .where(
        and(inArray(recipientContacts.phoneKey, keyed.map((x) => x.key)), ne(recipientContacts.charityId, ctx.charityId), eq(recipientContacts.isDemo, need.isDemo)),
      );

    const first = recipientStatus({ sample: k, total: keyed.length, yes: 0, no: 0, sharedNumbers: shared, expired: false });
    const [proof] = await tx
      .insert(proofs)
      .values({ needId: need.id, charityId: ctx.charityId, kind: "recipient_confirmation", status: first.status, reasons: first.reasons, submittedBy: ctx.userId })
      .returning({ id: proofs.id });
    const [check] = await tx
      .insert(recipientChecks)
      .values({ needId: need.id, charityId: ctx.charityId, proofId: proof!.id, totalRecipients: keyed.length, sampleSize: k, sharedNumbers: shared, createdBy: ctx.userId })
      .returning({ id: recipientChecks.id });

    const expiresAt = new Date(Date.now() + VALID_MS);
    for (const { n, key } of keyed) {
      if (!sampled.has(key)) {
        await tx.insert(recipientContacts).values({ checkId: check!.id, charityId: ctx.charityId, isDemo: need.isDemo, phoneKey: key });
        continue;
      }
      const token = randomBytes(32).toString("base64url");
      await tx
        .insert(recipientContacts)
        .values({ checkId: check!.id, charityId: ctx.charityId, isDemo: need.isDemo, phoneKey: key, sampled: true, tokenHash: tokenHash(token), expiresAt });
      texts.push({ to: maskPhone(n), token });
    }
    return { asked: k, total: keyed.length, charityName: need.charityName, title: need.title, isDemo: need.isDemo };
  });

  // Whoever listed the numbers first doesn't get a pass: their check is recounted and
  // goes to a person too (as with duplicate receipts). Separate transactions, one need at a time.
  const earlier = await db
    .selectDistinct({ checkId: recipientContacts.checkId })
    .from(recipientContacts)
    .where(
      and(inArray(recipientContacts.phoneKey, keyed.map((x) => x.key)), ne(recipientContacts.charityId, ctx.charityId), eq(recipientContacts.isDemo, sent.isDemo)),
    );
  for (const e of earlier) await db.transaction((tx) => refreshProof(tx, e.checkId, false, true)).catch(() => undefined);

  // Texts go out only after the check is saved: a failed save never texts anyone, and a
  // retry can't text the same people twice. A text that fails simply expires and goes to a
  // person - the numbers themselves are already gone (only the masked form is kept).
  for (const t of texts) {
    try {
      // A text message in production; the demo inbox stands in for it.
      await sendMail({
        kind: "recipient_check",
        to: t.to,
        charityId: ctx.charityId,
        subject: `Did you receive help from ${sent.charityName}?`,
        text: [
          `Proven here, checking for the donors to ${sent.charityName}.`,
          `Did you receive this: ${sent.title}?`,
          `One tap to answer: ${appUrl()}/r/${t.token}`,
          "You won't be asked again. (PayPal sandbox demo)",
        ].join("\n"),
      });
    } catch (e) {
      console.error("Recipient text failed", e?.constructor?.name);
    }
  }
  return { asked: sent.asked, total: sent.total };
}

export type RecipientQuestion = { charityName: string; needTitle: string; answered: "yes" | "no" | null };

/** What a recipient sees behind the texted link. Opening it never answers. */
export async function getRecipientQuestion(token: string): Promise<RecipientQuestion | null> {
  if (!TOKEN.test(token)) return null;
  const [c] = await getDb()
    .select({ answer: recipientContacts.answer, expiresAt: recipientContacts.expiresAt, charityName: charities.name, needTitle: needs.title })
    .from(recipientContacts)
    .innerJoin(recipientChecks, eq(recipientChecks.id, recipientContacts.checkId))
    .innerJoin(needs, eq(needs.id, recipientChecks.needId))
    .innerJoin(charities, eq(charities.id, recipientChecks.charityId))
    .where(and(eq(recipientContacts.tokenHash, tokenHash(token)), eq(recipientContacts.sampled, true)))
    .limit(1);
  if (!c) return null;
  if (!c.answer && (!c.expiresAt || c.expiresAt < new Date())) return null;
  return { charityName: c.charityName, needTitle: c.needTitle, answered: c.answer };
}

/** A recipient's one tap. Single use; updates the proof from all answers so far. */
export async function answerRecipient(token: string, answer: "yes" | "no"): Promise<"done" | "already" | "invalid"> {
  if (!TOKEN.test(token)) return "invalid";
  return getDb().transaction(async (tx) => {
    const [c] = await tx
      .update(recipientContacts)
      .set({ answer, answeredAt: new Date() })
      .where(and(eq(recipientContacts.tokenHash, tokenHash(token)), eq(recipientContacts.sampled, true), isNull(recipientContacts.answer), gt(recipientContacts.expiresAt, new Date())))
      .returning({ checkId: recipientContacts.checkId });
    if (!c) {
      const [seen] = await tx.select({ id: recipientContacts.id }).from(recipientContacts).where(eq(recipientContacts.tokenHash, tokenHash(token))).limit(1);
      return seen ? "already" : "invalid";
    }
    await refreshProof(tx, c.checkId, false);
    return "done";
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Recomputes the proof from the answers, under a lock on the check (answers can land at once). */
async function refreshProof(tx: Tx, checkId: string, expired: boolean, recountShared = false) {
  // Take the need lock first (shared): a release reading this proof under the need lock
  // can't interleave with this change. Same lock order as releases: need, then check.
  const [owner] = await tx.select({ needId: recipientChecks.needId }).from(recipientChecks).where(eq(recipientChecks.id, checkId));
  await tx.select({ id: needs.id }).from(needs).where(eq(needs.id, owner!.needId)).for("share");
  const [check] = await tx
    .select({ proofId: recipientChecks.proofId, sample: recipientChecks.sampleSize, total: recipientChecks.totalRecipients, shared: recipientChecks.sharedNumbers, charityId: recipientChecks.charityId })
    .from(recipientChecks)
    .where(eq(recipientChecks.id, checkId))
    .for("update");
  if (recountShared) {
    // Numbers on this check that any other charity in the same pool has also listed.
    const [r] = await tx.execute<{ n: number }>(sql`
      select count(distinct mine.phone_key)::int as n from ${recipientContacts} mine
      where mine.check_id = ${checkId} and exists (
        select 1 from ${recipientContacts} other
        where other.phone_key = mine.phone_key and other.charity_id <> ${check!.charityId} and other.is_demo = mine.is_demo)`).then((x) => x.rows);
    check!.shared = Number(r?.n ?? 0);
    await tx.update(recipientChecks).set({ sharedNumbers: check!.shared }).where(eq(recipientChecks.id, checkId));
  }
  const [t] = await tx
    .select({
      yes: sql<number>`count(*) filter (where ${recipientContacts.answer} = 'yes')::int`,
      no: sql<number>`count(*) filter (where ${recipientContacts.answer} = 'no')::int`,
    })
    .from(recipientContacts)
    .where(and(eq(recipientContacts.checkId, checkId), eq(recipientContacts.sampled, true)));
  const r = recipientStatus({ sample: check!.sample, total: check!.total, yes: t?.yes ?? 0, no: t?.no ?? 0, sharedNumbers: check!.shared, expired });
  // A reviewer's decision is never overwritten: only a proof still being checked (or passed, if a late "no" arrives) moves.
  await tx
    .update(proofs)
    .set({ status: r.status, reasons: r.reasons })
    .where(and(eq(proofs.id, check!.proofId), inArray(proofs.status, ["checking", "passed"])));
}

/** Daily: checks whose links have all expired without enough answers go to a person. */
export async function sweepRecipientChecks(): Promise<number> {
  const db = getDb();
  const stale = await db
    .select({ id: recipientChecks.id })
    .from(recipientChecks)
    .innerJoin(proofs, eq(proofs.id, recipientChecks.proofId))
    .where(and(eq(proofs.status, "checking"), lt(recipientChecks.createdAt, new Date(Date.now() - VALID_MS))))
    .limit(100);
  for (const s of stale) await db.transaction((tx) => refreshProof(tx, s.id, true));
  return stale.length;
}

export type RecipientCheckSummary = { total: number; sample: number; yes: number; no: number };

/** The charity's view: counts only - never who was asked or what they said. */
export async function recipientCheckSummary(ctx: CharityContext, needId: string): Promise<RecipientCheckSummary | null> {
  if (!UUID.test(needId)) return null;
  const [r] = await getDb()
    .select({
      total: recipientChecks.totalRecipients,
      sample: recipientChecks.sampleSize,
      yes: sql<number>`count(${recipientContacts.id}) filter (where ${recipientContacts.answer} = 'yes')::int`,
      no: sql<number>`count(${recipientContacts.id}) filter (where ${recipientContacts.answer} = 'no')::int`,
    })
    .from(recipientChecks)
    .leftJoin(recipientContacts, eq(recipientContacts.checkId, recipientChecks.id))
    .where(and(eq(recipientChecks.needId, needId), eq(recipientChecks.charityId, ctx.charityId)))
    .groupBy(recipientChecks.id)
    .limit(1);
  return r ?? null;
}

/** Reviewer-only detail for a need's recipient check: how many numbers other charities also listed. Never shown to charities. */
export async function sharedNumbersForReviewer(needId: string): Promise<{ proofId: string; shared: number } | null> {
  if (!UUID.test(needId)) return null;
  const [r] = await getDb()
    .select({ proofId: recipientChecks.proofId, shared: recipientChecks.sharedNumbers })
    .from(recipientChecks)
    .where(eq(recipientChecks.needId, needId))
    .limit(1);
  return r ?? null;
}
