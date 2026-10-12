"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

type Tone = "danger" | "primary";

/** Space the panel needs (px); with less below the button it opens above. */
const PANEL_ROOM = 260;

/**
 * A button that asks before it acts. The question opens as a small panel next
 * to the button; the action runs only from the panel's own confirm button.
 */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Keep it",
  tone = "primary",
  action,
  align = "right",
  className = "",
}: {
  label: string;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** What the confirm button says while the action runs, e.g. "Paying...". */
  pendingLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  action: () => Promise<{ error?: string } | void>;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [above, setAbove] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    stayRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!pending && !rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pending]);

  const trigger =
    tone === "danger"
      ? "border border-[#c9a3a3] text-[#8a2b2b] hover:border-[#8a2b2b] hover:bg-[#fcebeb]"
      : "bg-ink text-paper hover:bg-ink-soft";
  const confirm = tone === "danger" ? "bg-[#8a2b2b] text-white" : "bg-ink text-paper";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(undefined);
          // Open above when the panel wouldn't fit below, so the page never grows or jumps.
          const r = triggerRef.current?.getBoundingClientRect();
          if (r) setAbove(window.innerHeight - r.bottom < PANEL_ROOM && r.top > PANEL_ROOM);
          setOpen((o) => !o);
        }}
        className={`rounded-full px-4 py-2 text-sm transition-colors duration-(--duration-quick) ${trigger}`}
      >
        {label}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="alertdialog"
            aria-labelledby={`${id}-t`}
            aria-describedby={`${id}-d`}
            initial={{ opacity: 0, y: above ? 6 : -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: above ? 4 : -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 460, damping: 30 }}
            style={{ originX: align === "right" ? 1 : 0, originY: above ? 1 : 0 }}
            className={`absolute ${align === "right" ? "right-0" : "left-0"} ${above ? "bottom-full mb-2" : "top-full mt-2"} z-30 w-[min(20rem,calc(100vw-2rem))] rounded-[12px] border border-line bg-card p-4 text-left shadow-[0_18px_40px_-18px_rgba(15,30,61,0.35)]`}
          >
            <p id={`${id}-t`} className="font-serif text-base text-ink">{title}</p>
            <div id={`${id}-d`} className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</div>
            {error && (
              <p role="alert" className="rise-in mt-3 text-xs text-[#a32d2d]">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={stayRef}
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="rounded-full border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:border-ink-muted disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await action();
                    if (r && r.error) setError(r.error);
                    else setOpen(false);
                  })
                }
                className={`rounded-full px-3.5 py-1.5 text-sm transition-transform active:scale-[0.97] disabled:opacity-70 ${confirm}`}
              >
                {pending ? pendingLabel : confirmLabel}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
