"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

type Option = { value: string; label: string; hint: string };

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors duration-(--duration-quick) ${on ? "border-ink bg-ink" : "border-line bg-card"}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <motion.path
          d="M4 12.5 L10 18 L20 6"
          stroke="#f7f5ef"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        />
      </svg>
    </span>
  );
}

type ProofOption = Option;

/**
 * Proof choices for a new need, as cards. `required` (the PayPal supplier
 * payment) is always on and can't be unticked; the charity adds at least one
 * second check. Real checkboxes underneath, so the form and keyboard work as usual.
 */
export function ProofPicker({ name, options, required, defaultValues = [] }: { name: string; options: ProofOption[]; required: string; defaultValues?: string[] }) {
  const [picked, setPicked] = useState<string[]>([required, ...defaultValues.filter((v) => v !== required)]);

  const toggle = (v: string) => {
    if (v === required) return;
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };

  const seconds = picked.filter((v) => v !== required).length;
  const ready = seconds >= 1;
  const status = ready ? `PayPal supplier payment + ${seconds} ${seconds === 1 ? "check" : "checks"} - you get paid when they agree` : "Pick at least one second check";

  return (
    <div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const on = picked.includes(o.value);
          const locked = o.value === required;
          return (
            <motion.label
              key={o.value}
              whileTap={locked ? undefined : { scale: 0.985 }}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-(--duration-quick) has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/25 ${
                locked ? "cursor-default border-ink bg-[#eef1f7] sm:col-span-2" : on ? "cursor-pointer border-ink bg-[#eef1f7]" : "cursor-pointer border-line bg-card hover:border-ink-muted"
              }`}
            >
              {/* No name: React resets a form after a submit, which would untick these while the picker still shows them ticked. The hidden inputs below carry the value. */}
              <input type="checkbox" value={o.value} checked={on} disabled={locked} onChange={() => toggle(o.value)} className="sr-only" />
              <span className="mt-0.5"><Tick on={on} /></span>
              <span>
                <span className="block text-sm text-ink">
                  {o.label}
                  {locked && <span className="ml-2 text-xs text-ink-muted">Always required</span>}
                </span>
                <span className="block text-xs text-ink-muted">{o.hint}</span>
              </span>
            </motion.label>
          );
        })}
      </div>
      {picked.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <div className="mt-3 flex items-center gap-3" aria-live="polite">
        <div className="flex gap-1" aria-hidden="true">
          {[true, ready].map((lit, i) => (
            <motion.span
              key={i}
              className="h-1.5 w-8 rounded-full"
              initial={false}
              animate={{ backgroundColor: lit ? "#1f7a4d" : "#e6e2d8" }}
              transition={{ duration: 0.25 }}
            />
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`text-xs ${ready ? "text-proven-text" : "text-ink-muted"}`}
          >
            {status}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A two-option choice with a pill that slides to the selection. Real radios underneath. */
export function SlidingChoice({ name, options, defaultValue, layoutId }: { name: string; options: Option[]; defaultValue: string; layoutId: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div role="radiogroup" className="mt-3 grid gap-1 rounded-[10px] border border-line bg-[#efece4] p-1 sm:grid-cols-2">
      <input type="hidden" name={name} value={value} />
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label key={o.value} className="relative cursor-pointer rounded-[7px] px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/25">
            {on && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[7px] bg-card shadow-[0_1px_0_rgba(15,30,61,0.08),0_6px_16px_-10px_rgba(15,30,61,0.4)]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            {/* Grouped under a separate name so a form reset can't clear the real value (hidden input below). */}
            <input type="radio" name={`${name}-choice`} value={o.value} checked={on} onChange={() => setValue(o.value)} className="sr-only" />
            <span className="relative block text-sm text-ink">{o.label}</span>
            <span className="relative block text-xs text-ink-muted">{o.hint}</span>
          </label>
        );
      })}
    </div>
  );
}
