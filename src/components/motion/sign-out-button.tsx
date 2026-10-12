"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/signin/actions";

/** Sign out, with a small confirmation so a stray click doesn't end the session. */
export function SignOutButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    stayRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-ink px-4 py-1.5 text-ink transition-colors duration-(--duration-quick) hover:bg-ink hover:text-paper"
      >
        Sign out
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="alertdialog"
            aria-labelledby="signout-title"
            aria-describedby="signout-desc"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 460, damping: 30 }}
            style={{ originX: 1, originY: 0 }}
            className="absolute right-0 z-30 mt-2 w-64 rounded-[12px] border border-line bg-card p-4 text-left shadow-[0_18px_40px_-18px_rgba(15,30,61,0.35)]"
          >
            <p id="signout-title" className="font-serif text-base text-ink">Sign out of Proven?</p>
            <p id="signout-desc" className="mt-1 text-xs text-ink-muted">Holds and needs stay as they are. You can sign back in with PayPal anytime.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={stayRef}
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="rounded-full border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:border-ink-muted"
              >
                Stay signed in
              </button>
              <form action={signOutAction}>
                <button type="submit" className="rounded-full bg-ink px-3.5 py-1.5 text-sm text-paper transition-transform active:scale-[0.97]">
                  Sign out
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
