"use client";

import { useLayoutEffect, useRef, useState } from "react";

const MAX_WHOLE_DIGITS = 9;

/** Keeps digits and one dot, at most 2 decimals: what a person means by an amount. */
export function cleanAmount(raw: string): string {
  let out = "";
  let dot = false;
  let decimals = 0;
  let whole = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (dot) {
        if (decimals >= 2) continue;
        decimals++;
      } else {
        if (whole >= MAX_WHOLE_DIGITS) continue;
        whole++;
      }
      out += ch;
    } else if (ch === "." && !dot) {
      dot = true;
      out += ch;
    }
  }
  return out;
}

/** "1234567.5" -> "1,234,567.5". Display only - the plain number is what gets submitted. */
export function groupAmount(plain: string): string {
  const [w = "", f] = plain.split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f === undefined ? grouped : `${grouped}.${f}`;
}

/**
 * The one money field: shows thousands separators as you type (50,000 never
 * 50000), keeps the caret where you were typing, and submits the plain number
 * under `name` through a hidden input.
 */
export function MoneyInput({
  id,
  name,
  value,
  defaultValue = "",
  onChange,
  placeholder,
  className = "",
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  /** Controlled plain value ("1234.5"); omit to let the field keep its own. */
  value?: string;
  defaultValue?: string;
  onChange?: (plain: string) => void;
  /** Plain number; shown grouped. */
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [own, setOwn] = useState(() => cleanAmount(defaultValue));
  const plain = value !== undefined ? cleanAmount(value) : own;
  const ref = useRef<HTMLInputElement>(null);
  // How many digits/dots sit before the caret; restored after the commas move.
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const want = caret.current;
    if (!el || want === null || document.activeElement !== el) return;
    caret.current = null;
    let seen = 0;
    let pos = 0;
    while (pos < el.value.length && seen < want) {
      if (el.value[pos] !== ",") seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  });

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-ink-muted">$</span>
      <input
        ref={ref}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={groupAmount(plain)}
        placeholder={placeholder ? groupAmount(cleanAmount(placeholder)) : undefined}
        onChange={(e) => {
          const typed = e.target.value;
          const before = typed.slice(0, e.target.selectionStart ?? typed.length);
          caret.current = cleanAmount(before).length;
          const next = cleanAmount(typed);
          if (value === undefined) setOwn(next);
          onChange?.(next);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-md border border-line bg-card py-2.5 pl-7 pr-3 font-mono tabular-nums text-ink outline-none transition-[border-color,box-shadow] duration-(--duration-quick) focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)] ${className}`}
      />
      {/* "120." while typing is submitted as "120". */}
      <input type="hidden" name={name} value={plain.replace(/\.$/, "")} />
    </div>
  );
}
