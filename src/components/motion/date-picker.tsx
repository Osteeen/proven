"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// All dates are plain YYYY-MM-DD strings handled in UTC, matching the server rules.
type YMD = string;

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toMs = (d: YMD) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number): YMD => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: YMD, n: number) => fromMs(toMs(d) + n * DAY);
const monthKey = (d: YMD) => d.slice(0, 7);
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return date.toISOString().slice(0, 7);
};
const pretty = (d: YMD) =>
  new Date(toMs(d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function monthGrid(key: string): (YMD | null)[] {
  const first = `${key}-01`;
  const lead = new Date(toMs(first)).getUTCDay();
  const cells: (YMD | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; monthKey(d) === key; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function DatePicker({
  name,
  min,
  max,
  today,
  defaultValue,
  invalid,
  describedBy,
  label,
}: {
  name: string;
  min: YMD;
  max: YMD;
  today: YMD;
  defaultValue?: YMD;
  invalid?: boolean;
  describedBy?: string;
  label: string;
}) {
  const [value, setValue] = useState<YMD | undefined>(defaultValue || undefined);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(monthKey(defaultValue || min));
  const [dir, setDir] = useState(0);
  const [focused, setFocused] = useState<YMD>(defaultValue || min);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const inRange = useCallback((d: YMD) => d >= min && d <= max, [min, max]);
  const cells = useMemo(() => monthGrid(view), [view]);

  const goMonth = (n: number) => {
    setDir(n);
    setView((v) => shiftMonth(v, n));
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (d: YMD) => {
    if (!inRange(d)) return;
    setValue(d);
    setFocused(d);
    close();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`);
    el?.focus({ preventScroll: true });
  }, [open, focused, view]);

  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focused, moves[e.key]!);
      if (monthKey(next) !== view) {
        setDir(next > focused ? 1 : -1);
        setView(monthKey(next));
      }
      setFocused(next);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const n = e.key === "PageDown" ? 1 : -1;
      goMonth(n);
      setFocused(addDays(focused, n * 30));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(focused);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const daysAway = value ? Math.round((toMs(value) - toMs(today)) / DAY) : undefined;

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={value ?? ""} />
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? pretty(value) : "choose a date"}`}
        aria-describedby={describedBy}
        onClick={() => {
          setView(monthKey(value || min));
          setFocused(value || min);
          setOpen((o) => !o);
        }}
        className={`mt-1.5 flex w-full items-center justify-between rounded-md border bg-card px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-(--duration-quick) outline-none focus-visible:border-ink focus-visible:shadow-[0_0_0_3px_rgba(15,30,61,0.12)] ${
          open ? "border-ink shadow-[0_0_0_3px_rgba(15,30,61,0.12)]" : invalid ? "border-[#e24b4a]" : "border-line hover:border-ink-muted"
        }`}
      >
        <span className={value ? "font-mono text-ink" : "text-ink-muted"}>{value ? pretty(value) : "Choose a date"}</span>
        <motion.svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-ink-muted" animate={{ rotate: open ? -8 : 0 }} aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={`${label} - choose a date`}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 460, damping: 32 }}
            style={{ originY: 0 }}
            className="absolute left-0 z-20 mt-2 w-[19.5rem] rounded-[12px] border border-line bg-card p-3 shadow-[0_18px_40px_-18px_rgba(15,30,61,0.35)]"
          >
            <div className="flex items-center justify-between px-1 pb-2">
              <button type="button" onClick={() => goMonth(-1)} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-[#efece4]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <div className="relative h-6 flex-1 overflow-hidden text-center">
                <AnimatePresence initial={false} custom={dir} mode="popLayout">
                  <motion.p
                    key={view}
                    custom={dir}
                    initial={{ x: dir * 40, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: dir * -40, opacity: 0 }}
                    className="font-serif text-base text-ink"
                    aria-live="polite"
                  >
                    {MONTHS[Number(view.slice(5, 7)) - 1]} {view.slice(0, 4)}
                  </motion.p>
                </AnimatePresence>
              </div>
              <button type="button" onClick={() => goMonth(1)} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-[#efece4]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 px-1 pb-1 text-center font-mono text-[11px] text-ink-muted" aria-hidden="true">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>

            <div className="relative overflow-hidden">
              <AnimatePresence initial={false} custom={dir} mode="popLayout">
                <motion.div
                  key={view}
                  ref={gridRef}
                  role="grid"
                  onKeyDown={onKey}
                  custom={dir}
                  initial={{ x: dir * 60, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: dir * -60, opacity: 0 }}
                  className="grid grid-cols-7 gap-y-1 px-1"
                >
                  {cells.map((d, i) => {
                    if (!d) return <span key={`b${i}`} />;
                    const ok = inRange(d);
                    const selected = d === value;
                    const isToday = d === today;
                    const prevIn = ok && inRange(addDays(d, -1)) && i % 7 !== 0;
                    const nextIn = ok && inRange(addDays(d, 1)) && i % 7 !== 6;
                    return (
                      <div key={d} className="relative flex h-9 items-center justify-center">
                        {ok && (
                          <span
                            aria-hidden="true"
                            className={`absolute inset-y-1 bg-held-bg/70 ${prevIn ? "left-0" : "left-1 rounded-l-full"} ${nextIn ? "right-0" : "right-1 rounded-r-full"}`}
                          />
                        )}
                        {selected && (
                          <motion.span layoutId="date-picker-selected" className="absolute h-8 w-8 rounded-full bg-ink" transition={{ type: "spring", stiffness: 520, damping: 34 }} />
                        )}
                        <button
                          type="button"
                          data-day={d}
                          tabIndex={d === focused ? 0 : -1}
                          aria-disabled={!ok}
                          aria-pressed={selected}
                          aria-label={`${pretty(d)}${ok ? "" : ", outside the hold window"}`}
                          onClick={() => choose(d)}
                          className={`relative z-10 h-8 w-8 rounded-full font-mono text-[13px] outline-none transition-colors duration-(--duration-quick) focus-visible:ring-2 focus-visible:ring-ink/40 ${
                            selected ? "text-paper" : ok ? "text-ink hover:bg-[#f3dcb2]" : "cursor-not-allowed text-[#b7b3a8]"
                          } ${isToday && !selected ? "ring-1 ring-ink-muted" : ""}`}
                        >
                          {Number(d.slice(8))}
                        </button>
                      </div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-2 flex items-center gap-2 border-t border-dashed border-line px-1 pt-2.5 text-xs text-ink-muted">
              <span className="inline-block h-2.5 w-4 rounded-full bg-held-bg" aria-hidden="true" />
              Dates a donor&apos;s PayPal hold can cover
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {value && daysAway !== undefined && (
          <motion.p
            key={value}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 text-xs text-ink-soft"
          >
            {daysAway} days from today - donors&apos; holds cover it with room to spare.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
