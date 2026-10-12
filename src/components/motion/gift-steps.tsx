"use client";

import { motion } from "motion/react";

const STEPS = ["Held", "Proved", "Settled"];

/**
 * The donor's three-step track. Steps fill one after another; the current step
 * breathes so it reads as "in progress", not finished.
 */
export function GiftSteps({ stage, outcome }: { stage: 0 | 1 | 2; outcome: "proven" | "void" | "open" }) {
  const fill = (i: number) => (i === 0 ? "bg-held" : i === 1 ? "bg-ink" : outcome === "proven" ? "bg-proven" : "bg-void");
  return (
    <ol className="mt-10 grid grid-cols-3 gap-3" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i <= stage;
        const current = i === stage && outcome === "open";
        return (
          <motion.li
            key={s}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.1 + i * 0.12 }}
            aria-current={current ? "step" : undefined}
          >
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e6e2d8]">
              {done && (
                <motion.div
                  className={`h-full rounded-full ${fill(i)}`}
                  style={{ originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={current ? { scaleX: 1, opacity: [1, 0.55, 1] } : { scaleX: 1 }}
                  transition={
                    current
                      ? { scaleX: { type: "spring", stiffness: 120, damping: 20, delay: 0.35 + i * 0.3 }, opacity: { repeat: Infinity, duration: 2.4, ease: "easeInOut", delay: 1.2 } }
                      : { type: "spring", stiffness: 120, damping: 20, delay: 0.35 + i * 0.3 }
                  }
                />
              )}
            </div>
            <p className={`mt-2 font-mono text-xs ${done ? "text-ink" : "text-ink-muted"}`}>
              0{i + 1} {s}
            </p>
          </motion.li>
        );
      })}
    </ol>
  );
}
