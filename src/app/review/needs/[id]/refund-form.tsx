"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";
import { MoneyInput } from "@/components/money-input";
import { formatUsd } from "@/server/money";
import { refundAction, type RefundFormState } from "../../actions";

function toCentsOrUndefined(plain: string): number | undefined {
  const v = plain.replace(/\.$/, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return undefined;
  const [w, f = ""] = v.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/**
 * Refund in one surface: amount and reason, then the button turns into an
 * inline "Refund $X? Cancel / Yes, refund" - no second popup.
 */
export function RefundForm({ needId, refundableCents, donorCount }: { needId: string; refundableCents: number; donorCount: number }) {
  const [state, action, pending] = useActionState<RefundFormState, FormData>(refundAction.bind(null, needId), {});
  const [amount, setAmount] = useState(state.amount ?? "");
  const [confirming, setConfirming] = useState(false);
  const amountCents = toCentsOrUndefined(amount);
  const tooMuch = amountCents !== undefined && amountCents > refundableCents;
  const ready = !!amountCents && !tooMuch;

  if (state.done) {
    return (
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        className={`rounded-[10px] border px-4 py-3 text-sm ${state.done === "completed" ? "border-proven/30 bg-proven-bg text-proven-text" : "border-held/30 bg-held-bg text-held-text"}`}
      >
        {state.done === "completed"
          ? "Refunded. PayPal is sending the money back and donors were emailed."
          : "PayPal didn't finish every part of the refund. Nothing was refunded twice - the details are below."}
      </motion.p>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="amount" className="text-sm font-medium text-ink">Amount to refund</label>
          <div className="mt-1.5">
            <MoneyInput id="amount" name="amount" value={amount} onChange={(v) => { setAmount(v); setConfirming(false); }} placeholder={(refundableCents / 100).toFixed(2)} invalid={tooMuch} describedBy="refund-note" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setAmount((refundableCents / 100).toFixed(2)); setConfirming(false); }}
          className="rounded-full border border-line px-3 py-2 text-xs text-ink transition-colors hover:border-ink-muted"
        >
          All {formatUsd(refundableCents)}
        </button>
      </div>
      <p id="refund-note" className={`text-xs ${tooMuch ? "text-[#a32d2d]" : "text-ink-muted"}`}>
        {tooMuch
          ? `Only ${formatUsd(refundableCents)} can be refunded.`
          : `${donorCount === 1 ? "Goes back to the donor." : `Split across ${donorCount} donors in proportion to what each was charged.`} The charity's PayPal account pays it back.`}
      </p>

      <div>
        <label htmlFor="reason" className="text-sm font-medium text-ink">Why</label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          maxLength={500}
          defaultValue={state.reason}
          onChange={() => setConfirming(false)}
          placeholder="Supplier says no such order was placed."
          className="mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2.5 text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]"
        />
        <p className="mt-1 text-xs text-ink-muted">Donors see this in their refund email.</p>
      </div>

      {state.error && (
        <p role="alert" className="rise-in rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
          {state.error}
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-[#efece4] px-4 py-3">
            <span className="text-sm text-ink">Refund {formatUsd(amountCents ?? 0)}? This can&apos;t be undone.</span>
            <span className="ml-auto flex gap-2">
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded-full border border-line px-3.5 py-1.5 text-sm text-ink hover:border-ink-muted disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={pending} className="rounded-full bg-[#8a2b2b] px-3.5 py-1.5 text-sm text-white transition-transform active:scale-[0.97] disabled:opacity-70">
                {pending ? "Refunding..." : "Yes, refund"}
              </button>
            </span>
          </motion.div>
        ) : (
          <motion.button
            key="start"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            disabled={!ready}
            onClick={() => setConfirming(true)}
            className="rounded-full border border-[#c9a3a3] px-5 py-2.5 text-sm text-[#8a2b2b] transition-colors hover:border-[#8a2b2b] hover:bg-[#fcebeb] disabled:opacity-40"
          >
            {ready ? `Refund ${formatUsd(amountCents!)}` : "Refund"}
          </motion.button>
        )}
      </AnimatePresence>
    </form>
  );
}
