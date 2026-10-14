"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";
import { MoneyInput } from "@/components/money-input";
import { formatUsd } from "@/server/money";
import { reviewReason } from "@/server/releases/rules";
import { requestReleaseAction, type ReleaseFormState } from "./actions";

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

function parseCents(raw: string): number | undefined {
  const v = raw.replace(/[$,\s]/g, "").replace(/\.$/, "");
  if (!AMOUNT.test(v)) return undefined;
  const [w, f = ""] = v.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/**
 * One kind of release per form: the booking payment (staged needs, before the
 * supplier is paid) or the final release (after the supplier payment and a
 * second check, capped at what suppliers were paid).
 */
export function ReleaseForm({
  needId,
  kind,
  heldCents,
  advanceLeftCents,
  finalRoomCents,
  proofChecked,
  requiresSupplierPayment,
  donorCount,
  trustTier,
  completedReleases,
  thresholdCents,
}: {
  needId: string;
  kind: "advance" | "final";
  heldCents: number;
  advanceLeftCents: number;
  /** Most a final release may take under the supplier-payment rule; null when the need predates it. */
  finalRoomCents: number | null;
  proofChecked: boolean;
  requiresSupplierPayment: boolean;
  donorCount: number;
  trustTier: "new" | "established" | "trusted";
  completedReleases: number;
  thresholdCents: number;
}) {
  const [state, action, pending] = useActionState<ReleaseFormState, FormData>(requestReleaseAction.bind(null, needId), {});
  const [amount, setAmount] = useState(state.amount ?? "");
  const amountCents = parseCents(amount);
  const capByRule = kind === "final" && finalRoomCents !== null && finalRoomCents < heldCents;
  const max = kind === "advance" ? advanceLeftCents : capByRule ? finalRoomCents! : heldCents;
  const tooMuch = amountCents !== undefined && amountCents > max;
  const review = amountCents ? reviewReason({ kind, trustTier, completedReleases, amountCents, thresholdCents, proofChecked, requiresSupplierPayment }) : null;
  const pct = amountCents && heldCents ? Math.min(100, Math.round((amountCents / heldCents) * 100)) : 0;

  if (state.done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        className={`rounded-[10px] border px-4 py-3 text-sm ${
          state.done === "completed" ? "border-proven/30 bg-proven-bg text-proven-text" : state.done === "pending_review" ? "border-review/30 bg-review-bg text-review-text" : "border-[#f09595] bg-[#fcebeb] text-[#791f1f]"
        }`}
      >
        {state.done === "completed" && "Released. PayPal has paid it to your account - the details are below."}
        {state.done === "pending_review" && "Sent for review. A reviewer checks it before PayPal pays it - nothing is charged until then."}
        {state.done === "failed" && "PayPal didn't finish this release. Nothing extra was charged - a reviewer can retry it."}
      </motion.div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="kind" value={kind} />

      <div>
        <label htmlFor="amount" className="text-sm font-medium text-ink">
          {kind === "advance" ? "Booking cost" : "What you actually spent"}
        </label>
        <div className="mt-1.5 max-w-xs">
          <MoneyInput
            id="amount"
            name="amount"
            value={amount}
            onChange={setAmount}
            placeholder={(max / 100).toFixed(2)}
            invalid={tooMuch}
            describedBy="amount-preview"
          />
        </div>
      </div>

      <div id="amount-preview" aria-live="polite" className="min-h-[4.5rem] rounded-[10px] bg-[#efece4] px-4 py-3 text-sm">
        <AnimatePresence mode="wait" initial={false}>
          {tooMuch ? (
            <motion.p key="over" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: [0, -5, 5, -3, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="text-[#a32d2d]">
              {kind === "advance"
                ? `Up front you can take up to ${formatUsd(max)}. The rest is released after delivery.`
                : capByRule
                  ? `You can release up to ${formatUsd(max)} - what you paid suppliers with PayPal, less what was already released.`
                  : `Only ${formatUsd(max)} is held for this need.`}
            </motion.p>
          ) : amountCents ? (
            <motion.div key="ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-ink-soft">
                  {donorCount === 1 ? "Your donor is" : `${donorCount} donors are`} charged {pct}% of what they hold
                </span>
                <span className="font-mono text-proven">{formatUsd(amountCents)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="text-ink-muted">{kind === "advance" ? "Still held until delivery" : "Never charged - PayPal releases it"}</span>
                <span className="font-mono text-ink-muted">{formatUsd(heldCents - amountCents)}</span>
              </div>
              {review && <p className="mt-2 text-xs text-review-text">A reviewer checks this first: {review.toLowerCase()}.</p>}
            </motion.div>
          ) : (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-ink-muted">
              {kind === "advance"
                ? "Enter the booking cost. It's taken from every donor's hold in proportion."
                : "Enter what you spent. Donors are charged that, in proportion, and the rest of every hold is cancelled."}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div>
        <label htmlFor="note" className="text-sm font-medium text-ink">Note for the record <span className="font-normal text-ink-muted">(optional)</span></label>
        <input id="note" name="note" maxLength={500} placeholder="Invoice 2291 from Valley Supply" className="mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2.5 text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]" />
      </div>

      {state.error && (
        <p role="alert" className="rise-in rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !amountCents || tooMuch}
        className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40"
      >
        {pending ? "Releasing..." : kind === "advance" ? "Release booking payment" : "Release and close"}
      </button>
    </form>
  );
}
