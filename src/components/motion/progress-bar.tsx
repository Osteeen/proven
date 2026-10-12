"use client";

import { motion } from "motion/react";

/** Held-so-far bar that fills with a spring once visible. */
export function ProgressBar({ pct, className = "h-1", delay = 0.15 }: { pct: number; className?: string; delay?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`overflow-hidden rounded-full bg-[#ece8de] ${className}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className="h-full rounded-full bg-held"
        style={{ originX: 0 }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: clamped / 100 }}
        viewport={{ once: true }}
        transition={{ type: "spring", stiffness: 120, damping: 22, delay }}
      />
    </div>
  );
}
