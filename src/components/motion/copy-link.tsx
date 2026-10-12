"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

/** Copies a page's full link, e.g. to paste into WhatsApp. */
export function CopyLinkButton({ path, label = "Copy link", className = "" }: { path: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const text = { idle: label, copied: "Copied", failed: "Couldn't copy" };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`relative inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-ink transition-colors duration-(--duration-quick) hover:border-ink-muted ${className}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </svg>
      {/* Every label sits in the same grid cell, so the button keeps the width of the longest
          one and nothing around it moves when the text changes. */}
      <span className="inline-grid" aria-live="polite">
        {(Object.keys(text) as (keyof typeof text)[]).map((k) => (
          <span key={k} aria-hidden="true" className="invisible col-start-1 row-start-1">{text[k]}</span>
        ))}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.15 }}
            className={`col-start-1 row-start-1 text-center ${state === "copied" ? "text-proven-text" : state === "failed" ? "text-[#a32d2d]" : ""}`}
          >
            {text[state]}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}
