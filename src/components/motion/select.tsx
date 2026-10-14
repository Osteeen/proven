"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

/**
 * A custom dropdown in the app's style. Works by keyboard (arrows, Home/End,
 * Enter, Escape, type a letter to jump) and announces itself as a listbox.
 * Pass `name` to submit the value with a form.
 */
export function Select({
  options,
  value,
  onChange,
  name,
  label,
  size = "md",
  field = false,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  name?: string;
  label: string;
  size?: "sm" | "md";
  /** Full width and shaped like the form's text fields; long labels are cut with "...". */
  field?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openAt = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    setOpen(false);
    buttonRef.current?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") buttonRef.current?.focus();
      return;
    } else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
  };

  const pad = field ? "w-full justify-between rounded-md px-3 py-2.5" : `rounded-full ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`;

  return (
    <div ref={rootRef} className={field ? "relative block w-full" : "relative inline-block"}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current.label}`}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openAt();
          }
        }}
        className={`flex items-center gap-2 border bg-card text-ink outline-none transition-[border-color,box-shadow] duration-(--duration-quick) focus-visible:shadow-[0_0_0_3px_rgba(15,30,61,0.12)] ${pad} ${
          open ? "border-ink" : "border-line hover:border-ink-muted"
        }`}
      >
        <span className={field ? "min-w-0 truncate text-left" : "whitespace-nowrap"}>{current.label}</span>
        <motion.svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-ink-muted" animate={{ rotate: open ? 180 : 0 }} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-opt-${active}`}
            onKeyDown={onListKey}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            style={{ originY: 0 }}
            className="absolute right-0 z-30 mt-2 min-w-full rounded-[12px] border border-line bg-card p-1 shadow-[0_18px_40px_-18px_rgba(15,30,61,0.35)] outline-none"
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`relative flex cursor-pointer items-center justify-between gap-6 ${field ? "" : "whitespace-nowrap"} rounded-[8px] ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"} text-ink`}
                >
                  {i === active && <motion.span layoutId={`${id}-hl`} className="absolute inset-0 rounded-[8px] bg-[#efece4]" transition={{ type: "spring", stiffness: 600, damping: 40 }} />}
                  <span className="relative">{o.label}</span>
                  <span className="relative w-3">
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <motion.path d="M4 12.5 L10 18 L20 6" stroke="#0f1e3d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
                      </svg>
                    )}
                  </span>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
