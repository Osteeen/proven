"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCharity } from "@/server/auth/access";
import { toCents } from "@/server/money";
import { MAX_PROOF_BYTES, ProofError, submitReceipt } from "@/server/proofs/service";
import { RecipientCheckError, startRecipientCheck } from "@/server/proofs/recipients";
import { cancelNeed, ReleaseError, requestRelease } from "@/server/releases/service";
import { DuplicateSupplierPayment, SupplierError, completeSupplierPayment, inviteSupplier, refreshInvitedSupplier, startSupplierPayment } from "@/server/suppliers/service";

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
  let done: "completed" | "pending_review" | "failed";
  try {
    amountCents = toCents(amount.replace(/[$,\s]/g, ""));
  } catch {
    return { error: "Enter an amount like 120 or 120.50.", amount, kind };
  }
  try {
    const r = await requestRelease(ctx, needId, { kind, amountCents, note: str(formData.get("note")) });
    refresh(needId);
    done = r.status;
  } catch (e) {
    if (e instanceof ReleaseError) return { error: e.message, amount, kind };
    console.error("Release request failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't start the release. Nothing was charged - try again.", amount, kind };
  }
  // A final release closes the need and its release form, so the outcome is shown as a page notice.
  redirect(`/dashboard/needs/${needId}?released=${done}`);
}

/** The charity closes its own need: every hold is cancelled and donors are never charged for it. */
export async function cancelNeedAction(needId: string): Promise<{ error?: string }> {
  const ctx = await requireCharity();
  try {
    const ok = await cancelNeed({ kind: "charity", ctx }, needId);
    refresh(needId);
    if (!ok) return { error: "The need is closed, but PayPal hasn't confirmed every donor's money is back yet. Anything left goes back on its own - nobody pays." };
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

export type PaySupplierState = { error?: string; repeat?: string; approveUrl?: string; supplierId?: string; amount?: string; description?: string };

/** The charity starts paying a connected supplier for its own need; the browser then goes to PayPal to approve. */
export async function paySupplierAction(needId: string, _prev: PaySupplierState, formData: FormData): Promise<PaySupplierState> {
  const ctx = await requireCharity();
  const input = { supplierId: str(formData.get("supplierId")), amount: str(formData.get("amount")).trim(), description: str(formData.get("description")) };
  try {
    const { approveUrl } = await startSupplierPayment(ctx, needId, { ...input, confirmRepeat: formData.get("confirmRepeat") === "1" });
    return { approveUrl };
  } catch (e) {
    if (e instanceof DuplicateSupplierPayment) return { repeat: e.message, ...input };
    const error = e instanceof SupplierError ? e.message : "Couldn't start the payment. Nothing was paid - try again.";
    if (!(e instanceof SupplierError)) console.error("Supplier payment start failed", e?.constructor?.name);
    return { error, ...input };
  }
}

export type InviteSupplierState = { error?: string; sent?: "invited" | "connected"; name?: string; email?: string };

/** The charity invites a supplier to connect PayPal. The invite goes to the supplier's email (demo inbox in the sandbox). */
export async function inviteSupplierAction(needId: string, _prev: InviteSupplierState, formData: FormData): Promise<InviteSupplierState> {
  const ctx = await requireCharity();
  const name = str(formData.get("name"));
  const email = str(formData.get("email"));
  try {
    const r = await inviteSupplier(ctx, { name, email });
    refresh(needId);
    return { sent: r.status };
  } catch (e) {
    const error = e instanceof SupplierError ? e.message : "Couldn't send the invite. Try again.";
    if (!(e instanceof SupplierError)) console.error("Supplier invite failed", e?.constructor?.name);
    return { error, name, email };
  }
}

/** Asks PayPal whether an invited supplier has connected yet. */
export async function checkSupplierAction(needId: string, supplierId: string): Promise<{ error?: string }> {
  const ctx = await requireCharity();
  try {
    const status = await refreshInvitedSupplier(ctx, supplierId);
    refresh(needId);
    return status === "connected" ? {} : { error: "Not connected yet. The supplier needs to finish connecting PayPal from the invite email." };
  } catch {
    return { error: "Couldn't reach PayPal. Try again." };
  }
}

/** Re-checks an unfinished supplier payment with PayPal (for when the charity didn't come back from PayPal). */
export async function checkSupplierPaymentAction(needId: string, paymentId: string): Promise<{ error?: string }> {
  const ctx = await requireCharity();
  try {
    const r = await completeSupplierPayment(ctx, paymentId);
    refresh(needId);
    return r.status === "completed" ? {} : { error: r.message };
  } catch {
    return { error: "Couldn't reach PayPal. Try again." };
  }
}

export type RecipientCheckState = { error?: string; numbers?: string };

/** The charity sends the recipient check for its own need. The numbers are never logged or kept. */
export async function startRecipientCheckAction(needId: string, _prev: RecipientCheckState, formData: FormData): Promise<RecipientCheckState> {
  const ctx = await requireCharity();
  const numbers = str(formData.get("numbers"));
  if (numbers.length > 40_000) return { error: "That list is too long - enter up to 1,000 numbers." };
  try {
    await startRecipientCheck(ctx, needId, { numbers, consent: str(formData.get("consent")) === "yes" });
    refresh(needId);
    return {};
  } catch (e) {
    if (e instanceof RecipientCheckError) return { error: e.message, numbers };
    console.error("Recipient check failed", e?.constructor?.name); // never the message: it could echo a number
    return { error: "Couldn't send the recipient check. Try again.", numbers };
  }
}
