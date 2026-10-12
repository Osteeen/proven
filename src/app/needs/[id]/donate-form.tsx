"use client";

import { motion } from "motion/react";
import { useActionState, useState } from "react";
import { groupAmount, MoneyInput } from "@/components/money-input";
import type { DonateState } from "./actions";

const PRESETS = [10, 25, 50, 100];

/** Gift amount + "Fund with PayPal". Used for first gifts and for adding to a gift. */
export function DonateForm({
  action: serverAction,
  remainingCents,
  remainingLabel,
  submitLabel = "Fund with PayPal",
  label = "Your gift",
}: {
  action: (prev: DonateState, formData: FormData) => Promise<DonateState>;
  remainingCents: number;
  remainingLabel: string;
  submitLabel?: string;
  label?: string;
}) {
  const [state, action, pending] = useActionState<DonateState, FormData>(serverAction, {});
  // Only offer presets that fit what's still needed, plus "the rest" when it's small.
  const presets = PRESETS.filter((p) => p * 100 <= remainingCents).map(String);
  const rest = remainingCents < 10000 ? (remainingCents / 100).toFixed(remainingCents % 100 ? 2 : 0) : undefined;
  const options = rest && !presets.includes(rest) ? [...presets, rest] : presets;
  const [amount, setAmount] = useState(state.amount ?? options.find((o) => o === "25") ?? options[0] ?? "");

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="amount" className="text-sm font-medium text-ink">{label}</label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {options.slice(0, 4).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              aria-pressed={amount === p}
              className="relative rounded-md border border-line py-2 font-mono text-sm text-ink transition-[border-color,color] duration-(--duration-quick) hover:border-ink-muted active:scale-[0.97] aria-pressed:border-ink aria-pressed:text-paper"
            >
              {amount === p && <motion.span layoutId="gift-preset" className="absolute inset-0 rounded-[5px] bg-ink" transition={{ type: "spring", stiffness: 520, damping: 36 }} />}
              <span className="relative">{p === rest ? `All $${groupAmount(p)}` : `$${groupAmount(p)}`}</span>
            </button>
          ))}
        </div>
        <div className="mt-2">
          <MoneyInput id="amount" name="amount" value={amount} onChange={setAmount} describedBy="amount-note donate-err" />
        </div>
        <p id="amount-note" className="mt-1.5 text-xs text-ink-muted">{remainingLabel} still needed.</p>
      </div>

      {state.error && (
        <p id="donate-err" role="alert" className="rise-in text-sm text-[#a32d2d]">
          {state.error}
        </p>
      )}

      <motion.button
        type="submit"
        disabled={pending}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        className="relative w-full overflow-hidden rounded-full bg-[#ffc439] py-3 text-sm font-semibold text-[#111] transition-[filter] duration-(--duration-quick) hover:brightness-95 disabled:opacity-70"
      >
        {pending && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
            initial={{ x: "-120%" }}
            animate={{ x: "320%" }}
            transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
          />
        )}
        <span className="relative">{pending ? "Opening PayPal..." : submitLabel}</span>
      </motion.button>
      <p className="text-center text-xs text-ink-muted">PayPal holds your gift. You&apos;re charged only if delivery is proven.</p>
    </form>
  );
}
