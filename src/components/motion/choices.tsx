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

type ProofOption = Option & { independent: boolean };

/**
 * Proof types as cards. Release needs two proofs, at least one of them from
 * someone other than the charity. Picking a second piece of the charity's own
 * evidence (receipt + photo) with nothing independent is refused on the spot.
 * Real checkboxes underneath, so the form and keyboard work as usual.
 */
export function ProofPicker({ name, options, defaultValues = [] }: { name: string; options: ProofOption[]; defaultValues?: string[] }) {
  const [picked, setPicked] = useState<string[]>(defaultValues);
  const [blocked, setBlocked] = useState<{ value: string; n: number } | null>(null);
  const isIndependent = (v: string) => options.find((o) => o.value === v)?.independent ?? false;

  const toggle = (v: string) => {
    if (picked.includes(v)) {
      setPicked((p) => p.filter((x) => x !== v));
      return;
    }
    const next = [...picked, v];
    const ownOnly = next.length >= 2 && !next.some(isIndependent);
    if (ownOnly) {
      setBlocked((b) => ({ value: v, n: (b?.n ?? 0) + 1 }));
      return;
    }
    setBlocked(null);
    setPicked(next);
  };

  const independent = picked.filter(isIndependent).length;
  const ready = picked.length >= 2 && independent >= 1;
  const status = blocked
    ? "Receipt and photo both come from you - first pick a supplier or recipient confirmation"
    : ready
      ? `${picked.length} checks - money can be released when they agree`
      : picked.length >= 2
        ? "Add a supplier or recipient confirmation"
        : `${2 - picked.length} more to go`;

  return (
    <div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const on = picked.includes(o.value);
          const shake = blocked?.value === o.value;
          return (
            <motion.label
              key={o.value}
              whileTap={{ scale: 0.985 }}
              // The last keyframe alternates by a hair so every blocked click shakes again.
              animate={shake ? { x: [0, -6, 6, -4, 4, (blocked?.n ?? 0) % 2 ? 0 : 0.01] } : { x: 0 }}
              transition={{ duration: 0.35 }}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-(--duration-quick) has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/25 ${
                on ? "border-ink bg-[#eef1f7]" : shake ? "border-[#e0a3a3] bg-card" : "border-line bg-card hover:border-ink-muted"
              }`}
            >
              <input type="checkbox" name={name} value={o.value} checked={on} onChange={() => toggle(o.value)} className="sr-only" />
              <span className="mt-0.5"><Tick on={on} /></span>
              <span>
                <span className="block text-sm text-ink">{o.label}</span>
                <span className="block text-xs text-ink-muted">{o.hint}</span>
              </span>
            </motion.label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3" aria-live="polite">
        <div className="flex gap-1" aria-hidden="true">
          {[picked.length >= 1, ready].map((lit, i) => (
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
            key={`${status}-${blocked?.n ?? 0}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`text-xs ${blocked ? "text-[#a32d2d]" : ready ? "text-proven-text" : "text-ink-muted"}`}
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
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label key={o.value} className="relative cursor-pointer rounded-[7px] px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/25">
            {on && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[7px] bg-card shadow-[0_1px_0_rgba(15,30,61,0.08),0_6px_16px_-10px_rgba(15,30,61,0.4)]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => setValue(o.value)} className="sr-only" />
            <span className="relative block text-sm text-ink">{o.label}</span>
            <span className="relative block text-xs text-ink-muted">{o.hint}</span>
          </label>
        );
      })}
    </div>
  );
}
