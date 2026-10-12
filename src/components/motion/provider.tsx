"use client";

import { MotionConfig } from "motion/react";

/** One place for motion defaults. "user" honours the device's reduce-motion setting. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
      {children}
    </MotionConfig>
  );
}

export const springs = {
  snappy: { type: "spring", stiffness: 520, damping: 34 },
  soft: { type: "spring", stiffness: 260, damping: 30 },
  bouncy: { type: "spring", stiffness: 420, damping: 18 },
} as const;
