"use server";

import { revalidatePath } from "next/cache";
import { requireCharity } from "@/server/auth/access";
import { toCents } from "@/server/money";
import { MAX_PROOF_BYTES, ProofError, submitReceipt } from "@/server/proofs/service";
import { cancelNeed, ReleaseError, requestRelease } from "@/server/releases/service";

export type ReleaseFormState = { error?: string; done?: "completed" | "pending_review" | "failed"; amount?: string; kind?: string };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

function refresh(needId: string) {
  revalidatePath(`/dashboard/needs/${needId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/needs/${needId}`);
  revalidatePath("/review");
}

/** The charity asks for money from its own need. Charity identity comes from the session only. */
export async function requestReleaseAction(needId: string, _prev: ReleaseFormState, formData: FormData): Promise<ReleaseFormState> {
  const ctx = await requireCharity();
  const amount = str(formData.get("amount")).trim();
  const kind = str(formData.get("kind")) === "advance" ? "advance" : "final";
  let amountCents: number;
  try {
    amountCents = toCents(amount.replace(/[$,\s]/g, ""));
  } catch {
    return { error: "Enter an amount like 120 or 120.50.", amount, kind };
  }
  try {
    const r = await requestRelease(ctx, needId, { kind, amountCents, note: str(formData.get("note")) });
    refresh(needId);
    return { done: r.status };
  } catch (e) {
    if (e instanceof ReleaseError) return { error: e.message, amount, kind };
    console.error("Release request failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't start the release. Nothing was charged - try again.", amount, kind };
  }
}

/** The charity closes its own need: every hold is cancelled and donors are never charged for it. */
export async function cancelNeedAction(needId: string): Promise<{ error?: string }> {
  const ctx = await requireCharity();
  try {
    const ok = await cancelNeed({ kind: "charity", ctx }, needId);
    refresh(needId);
    if (!ok) return { error: "The need is closed, but PayPal didn't confirm every hold was cancelled yet. Any hold left will lapse on its own and donors are never charged for it." };
    return {};
  } catch (e) {
    if (e instanceof ReleaseError) return { error: e.message };
    console.error("Cancel need failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't close the need. Try again." };
  }
}

export type ReceiptUploadState = { error?: string; result?: { status: string; reasons: string[] } };

/** The charity uploads a receipt for its own need; the AI reads it and our rules decide. */
export async function uploadReceiptAction(needId: string, _prev: ReceiptUploadState, formData: FormData): Promise<ReceiptUploadState> {
  const ctx = await requireCharity();
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo of the receipt." };
  if (file.size > MAX_PROOF_BYTES) return { error: "That image is too large - keep it under 5 MB." };
  try {
    const r = await submitReceipt(ctx, needId, { bytes: Buffer.from(await file.arrayBuffer()) });
    refresh(needId);
    return { result: { status: r.status, reasons: r.reasons } };
  } catch (e) {
    if (e instanceof ProofError) return { error: e.message };
    console.error("Receipt upload failed", e?.constructor?.name); // never the message: it can carry query parameters
    return { error: "Couldn't save the receipt. Try again." };
  }
}
