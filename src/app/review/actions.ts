"use server";

import { revalidatePath } from "next/cache";
import { requireReviewer } from "@/server/auth/access";
import { toCents } from "@/server/money";
import { refundNeed, retryRefund } from "@/server/releases/refunds";
import { approveRelease, cancelNeed, finishClosingNeed, rejectRelease, ReleaseError, retryRelease } from "@/server/releases/service";
import { rejectSupplier, revokeSupplier, SupplierError, verifySupplier } from "@/server/suppliers/service";

type Result = { error?: string };

function refresh() {
  revalidatePath("/review");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/needs", "layout");
}

async function run(fn: () => Promise<unknown>, failMsg: string): Promise<Result> {
  try {
    const r = await fn();
    refresh();
    if (r === "failed") return { error: "PayPal didn't finish it. Nothing happened twice - you can retry." };
    return {};
  } catch (e) {
    if (e instanceof ReleaseError) return { error: e.message };
    console.error(failMsg, e instanceof Error ? e.message : e);
    return { error: failMsg };
  }
}

// Every action checks the reviewer role from the session first; the release ID
// alone grants nothing.
export async function approveAction(releaseId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return run(() => approveRelease(reviewer, releaseId), "Couldn't approve the release. Try again.");
}

export async function rejectAction(releaseId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return run(() => rejectRelease(reviewer, releaseId, "Not approved by reviewer"), "Couldn't turn down the release. Try again.");
}

export async function retryAction(releaseId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  // Retries also pick up releases that stopped mid-way; PayPal's record is checked before any capture.
  return run(() => retryRelease(reviewer, releaseId), "Couldn't retry the release. Try again.");
}

export async function notProvenAction(needId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return run(async () => {
    const ok = await cancelNeed({ kind: "reviewer", ctx: reviewer }, needId);
    if (!ok) throw new ReleaseError("Marked not proven, but PayPal didn't confirm every hold was cancelled. Any hold left lapses on its own.");
  }, "Couldn't mark the need not proven. Try again.");
}

export async function finishClosingAction(needId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return run(async () => {
    const ok = await finishClosingNeed(reviewer, needId);
    if (!ok) throw new ReleaseError("PayPal still didn't confirm every hold. Any hold left lapses on its own - try again later.");
  }, "Couldn't finish closing the need. Try again.");
}

export type RefundFormState = { error?: string; done?: "completed" | "unfinished"; amount?: string; reason?: string };

/** A reviewer refunds charged money on a need. The reviewer comes from the session; the need ID grants nothing on its own. */
export async function refundAction(needId: string, _prev: RefundFormState, formData: FormData): Promise<RefundFormState> {
  const reviewer = await requireReviewer();
  const amount = typeof formData.get("amount") === "string" ? String(formData.get("amount")).trim() : "";
  const reason = typeof formData.get("reason") === "string" ? String(formData.get("reason")) : "";
  let amountCents: number;
  try {
    amountCents = toCents(amount.replace(/[$,\s]/g, ""));
  } catch {
    return { error: "Enter an amount like 40 or 40.50.", amount, reason };
  }
  try {
    const r = await refundNeed(reviewer, needId, { amountCents, reason });
    refresh();
    revalidatePath(`/review/needs/${needId}`);
    return { done: r.status };
  } catch (e) {
    if (e instanceof ReleaseError) return { error: e.message, amount, reason };
    console.error("Refund failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't start the refund. Nothing was refunded - try again.", amount, reason };
  }
}

export async function retryRefundAction(needId: string, batchId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  const r = await run(() => retryRefund(reviewer, batchId).then((s) => (s === "unfinished" ? "failed" : s)), "Couldn't retry the refund. Try again.");
  revalidatePath(`/review/needs/${needId}`);
  return r;
}

async function supplierRun(fn: () => Promise<void>, failMsg: string): Promise<Result> {
  try {
    await fn();
    refresh();
    return {};
  } catch (e) {
    if (e instanceof SupplierError) return { error: e.message };
    console.error(failMsg, e instanceof Error ? e.constructor.name : e);
    return { error: failMsg };
  }
}

/** The reviewer confirmed the supplier is a real, independent business. Scope is checked in the service. */
export async function verifySupplierAction(supplierId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return supplierRun(() => verifySupplier(reviewer, supplierId), "Couldn't verify the supplier. Try again.");
}

/** The reviewer couldn't confirm the supplier: it can't be paid and its payments don't count as proof. */
export async function rejectSupplierAction(supplierId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return supplierRun(() => rejectSupplier(reviewer, supplierId), "Couldn't update the supplier. Try again.");
}

/** The reviewer withdraws a verified supplier: it can't be paid, and proof resting on it fails. */
export async function revokeSupplierAction(supplierId: string): Promise<Result> {
  const reviewer = await requireReviewer();
  return supplierRun(() => revokeSupplier(reviewer, supplierId), "Couldn't revoke the supplier. Try again.");
}
