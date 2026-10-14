import "server-only";
import { sharedNumbersForReviewer } from "./recipients";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { CharityContext, ReviewerContext } from "@/server/auth/access";
import { reviewerMayActOn } from "@/server/auth/scope";
import { AiUnavailable } from "@/server/ai/claude";
import { getDb } from "@/server/db/client";
import { charities, needs, proofFiles, proofFingerprints, proofs } from "@/server/db/schema";
import { readReceipt } from "./receipt-ai";
import { assessReceipt, receiptKeys, type Duplicates } from "./receipt-rules";

export class ProofError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const MAX_PROOFS_PER_NEED = 12;
const MAX_PER_CHARITY_HOUR = 30;
const MAX_PROOFS_PER_DAY = 500;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const OPEN_FOR_PROOF = ["open", "funded", "delivering", "in_review"];

/** The file type from its first bytes - never from the name or the browser's claim. */
export function sniffImage(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Proofs stuck in "checking" (the process died mid-check) go to a person instead of waiting forever. */
export async function sweepStuckProofs(): Promise<number> {
  const rows = await getDb()
    .update(proofs)
    .set({ status: "needs_review", reasons: ["The check didn't finish - a person will look at this proof."] })
    .where(and(eq(proofs.status, "checking"), lt(proofs.createdAt, new Date(Date.now() - STUCK_AFTER_MS))))
    .returning({ id: proofs.id });
  return rows.length;
}

/**
 * A charity uploads a receipt for one of its own needs. The AI reads it, our
 * rules decide, and the result is stored. Receipts can only be added while the
 * need takes proof, for needs that list a receipt as proof, by an active charity.
 */
export async function submitReceipt(ctx: CharityContext, needId: string, file: { bytes: Buffer }): Promise<{ id: string; status: string; reasons: string[] }> {
  if (!UUID.test(needId)) throw new ProofError("Need not found.");
  if (file.bytes.length === 0) throw new ProofError("Choose a photo of the receipt.");
  if (file.bytes.length > MAX_PROOF_BYTES) throw new ProofError("That image is too large - keep it under 5 MB.");
  const mime = sniffImage(file.bytes);
  if (!mime) throw new ProofError("Upload a JPEG, PNG or WebP photo of the receipt.");

  const db = getDb();
  await sweepStuckProofs();
  // Ownership: the need must belong to the signed-in charity, and the charity must be active.
  const [need] = await db
    .select({
      id: needs.id,
      title: needs.title,
      description: needs.description,
      amountCents: needs.amountCents,
      status: needs.status,
      requiredProof: needs.requiredProof,
      createdAt: needs.createdAt,
      deadline: needs.deadline,
      charityName: charities.name,
      charityStatus: charities.status,
      isDemo: charities.isDemo,
    })
    .from(needs)
    .innerJoin(charities, eq(charities.id, needs.charityId))
    .where(and(eq(needs.id, needId), eq(needs.charityId, ctx.charityId)))
    .limit(1);
  if (!need) throw new ProofError("Need not found.");
  if (need.charityStatus !== "active") throw new ProofError("Your charity's account is on hold. Contact Proven.");
  if (!OPEN_FOR_PROOF.includes(need.status)) throw new ProofError("This need is closed - no more proof can be added.");
  if (!need.requiredProof.includes("receipt")) throw new ProofError("This need doesn't use a receipt as proof.");

  const sha = createHash("sha256").update(file.bytes).digest("hex");
  // The same file again for the same need: show the earlier result instead of judging it against itself.
  const [again] = await db
    .select({ id: proofs.id, status: proofs.status, reasons: proofs.reasons })
    .from(proofs)
    .where(and(eq(proofs.needId, need.id), eq(proofs.imageSha256, sha)))
    .limit(1);
  if (again) return { id: again.id, status: again.status, reasons: ["You already uploaded this receipt for this need.", ...again.reasons] };

  // Each check costs an AI call. Counted in the database, so limits survive restarts.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ mine = 0, onNeed = 0 } = {}] = await db
    .select({
      mine: sql<number>`count(*) filter (where ${proofs.charityId} = ${ctx.charityId} and ${proofs.createdAt} > ${hourAgo})::int`,
      onNeed: sql<number>`count(*) filter (where ${proofs.needId} = ${need.id})::int`,
    })
    .from(proofs);
  const [{ all = 0 } = {}] = await db.select({ all: sql<number>`count(*)::int` }).from(proofs).where(gt(proofs.createdAt, dayAgo));
  if (mine >= MAX_PER_CHARITY_HOUR) throw new ProofError("Too many uploads in the last hour. Try again later.");
  if (onNeed >= MAX_PROOFS_PER_NEED) throw new ProofError("This need already has the maximum number of proofs.");
  if (all >= MAX_PROOFS_PER_DAY) throw new ProofError("Proof checks are busy right now. Try again later.");

  const id = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(proofs)
      .values({ needId: need.id, charityId: ctx.charityId, kind: "receipt", status: "checking", imageSha256: sha, submittedBy: ctx.userId })
      .returning({ id: proofs.id });
    await tx.insert(proofFiles).values({ proofId: p!.id, charityId: ctx.charityId, mime, sizeBytes: file.bytes.length, bytes: file.bytes });
    return p!.id;
  });

  let reading;
  let model: string | null = null;
  try {
    ({ reading, model } = await readReceipt({ bytes: file.bytes, mime }, need));
  } catch (e) {
    // Class only: messages can carry receipt text.
    console.error("Receipt AI check unavailable", { proofId: id, error: e instanceof AiUnavailable ? e.message.slice(0, 80) : e?.constructor?.name });
    const reasons = ["The AI check couldn't run - a person will look at this receipt."];
    await db.update(proofs).set({ status: "needs_review", reasons }).where(and(eq(proofs.id, id), eq(proofs.status, "checking")));
    return { id, status: "needs_review", reasons };
  }

  const keys = receiptKeys(reading);
  return db.transaction(async (tx) => {
    // Serialise uploads sharing any key (or the same image), so two at once can't miss each other.
    for (const k of [...keys, `img:${sha}`].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${k}))`);

    // Matches on another need, in the same pool (demo receipts never touch real charities).
    const byImage = await tx
      .select({ id: proofs.id })
      .from(proofs)
      .innerJoin(charities, eq(charities.id, proofs.charityId))
      .where(and(eq(proofs.imageSha256, sha), ne(proofs.needId, need.id), eq(charities.isDemo, need.isDemo)))
      .limit(5);
    const byKey = keys.length
      ? await tx
          .select({ id: proofs.id })
          .from(proofFingerprints)
          .innerJoin(proofs, eq(proofs.id, proofFingerprints.proofId))
          .where(and(inArray(proofFingerprints.key, keys), eq(proofFingerprints.isDemo, need.isDemo), ne(proofs.needId, need.id)))
          .limit(5)
      : [];
    const matched = [...new Set([...byImage, ...byKey].map((m) => m.id))];
    const dup: Duplicates = { otherNeed: matched.length > 0, how: byImage.length ? "image" : byKey.length ? "details" : null };
    const decision = assessReceipt(reading, need, dup, new Date());

    if (keys.length) await tx.insert(proofFingerprints).values(keys.map((key) => ({ proofId: id, key, isDemo: need.isDemo }))).onConflictDoNothing();
    const [upd] = await tx
      .update(proofs)
      .set({
        status: decision.status,
        reasons: decision.reasons,
        ai: reading,
        aiModel: model,
        amountCents: decision.status === "passed" ? decision.amountCents : null,
        fingerprint: keys[0] ?? null,
        duplicateOf: matched[0] ?? null,
      })
      .where(and(eq(proofs.id, id), eq(proofs.status, "checking")))
      .returning({ id: proofs.id });
    if (!upd) {
      // Swept or changed while the AI was reading: keep what is there.
      const [cur] = await tx.select({ status: proofs.status, reasons: proofs.reasons }).from(proofs).where(eq(proofs.id, id));
      return { id, status: cur?.status ?? "needs_review", reasons: cur?.reasons ?? [] };
    }
    // The earlier copy goes to a person too: whoever uploaded first doesn't win.
    if (matched.length) {
      await tx
        .update(proofs)
        .set({
          status: "needs_review",
          amountCents: null,
          duplicateOf: id,
          reasons: sql`array_append(${proofs.reasons}, ${"A receipt matching this one was later submitted for a different need - a person will compare them."})`,
        })
        .where(and(inArray(proofs.id, matched), inArray(proofs.status, ["passed", "checking", "needs_review"])));
    }
    return { id, status: decision.status, reasons: decision.reasons };
  });
}

export type ProofView = {
  id: string;
  kind: string;
  status: string;
  reasons: string[];
  amountCents: number | null;
  createdAt: Date;
  merchant: string | null;
  purchaseDate: string | null;
  totalCents: number | null;
  items: { description: string; quantity: number | null; line_total_cents: number | null }[];
  concerns: string[];
  isDuplicate: boolean;
};

function toView(p: {
  id: string;
  kind: string;
  status: string;
  reasons: string[];
  amountCents: number | null;
  createdAt: Date;
  ai: Record<string, unknown> | null;
  duplicateOf: string | null;
}): ProofView {
  const ai = (p.ai ?? {}) as Partial<{
    merchant_name: string | null;
    purchase_date: string | null;
    total_cents: number | null;
    line_items: ProofView["items"];
    concerns: string[];
  }>;
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    reasons: p.reasons,
    amountCents: p.amountCents,
    createdAt: p.createdAt,
    merchant: ai.merchant_name ?? null,
    purchaseDate: ai.purchase_date ?? null,
    totalCents: ai.total_cents ?? null,
    items: Array.isArray(ai.line_items) ? ai.line_items.slice(0, 20) : [],
    concerns: Array.isArray(ai.concerns) ? ai.concerns : [],
    isDuplicate: !!p.duplicateOf,
  };
}

const VIEW_COLUMNS = {
  id: proofs.id,
  kind: proofs.kind,
  status: proofs.status,
  reasons: proofs.reasons,
  amountCents: proofs.amountCents,
  createdAt: proofs.createdAt,
  ai: proofs.ai,
  duplicateOf: proofs.duplicateOf,
};

/** A need's proofs as its own charity sees them (never another charity's). */
export async function listProofsForCharity(ctx: CharityContext, needId: string): Promise<ProofView[]> {
  if (!UUID.test(needId)) return [];
  const rows = await getDb()
    .select(VIEW_COLUMNS)
    .from(proofs)
    .where(and(eq(proofs.needId, needId), eq(proofs.charityId, ctx.charityId)))
    .orderBy(desc(proofs.createdAt));
  return rows.map(toView);
}

/** A need's proofs for a reviewer - only for charities this reviewer may see. */
export async function listProofsForNeed(reviewer: ReviewerContext, needId: string): Promise<ProofView[]> {
  if (!UUID.test(needId)) return [];
  const db = getDb();
  const [n] = await db.select({ charityId: needs.charityId }).from(needs).where(eq(needs.id, needId)).limit(1);
  if (!n || !(await reviewerMayActOn(reviewer, n.charityId))) return [];
  const rows = await db.select(VIEW_COLUMNS).from(proofs).where(eq(proofs.needId, needId)).orderBy(desc(proofs.createdAt));
  const views = rows.map(toView);
  // Reviewers (only) see how many recipient numbers other charities also listed.
  const shared = await sharedNumbersForReviewer(needId);
  if (shared && shared.shared > 0) {
    const v = views.find((p) => p.id === shared.proofId);
    if (v) v.reasons = [...v.reasons, `Reviewer note: ${shared.shared} of these numbers were also listed by another charity.`];
  }
  return views;
}
