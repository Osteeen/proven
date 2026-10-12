"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

function format(c: number) {
  const whole = Math.floor(c / 100).toLocaleString("en-US");
  return `$${whole}.${String(c % 100).padStart(2, "0")}`;
}

/** Money that counts up to its value when it scrolls into view. Always lands on the exact cents. */
export function AnimatedMoney({ cents, className = "", delay = 0 }: { cents: number; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const still = reduce || cents === 0;

  useEffect(() => {
    if (!inView || still) return;
    const controls = animate(0, cents, {
      duration: Math.min(1.4, 0.5 + cents / 100000),
      delay,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, cents, still, delay]);

  return (
    <span ref={ref} className={`font-mono tabular-nums ${className}`} aria-label={format(cents)}>
      <span aria-hidden="true">{format(still ? cents : shown)}</span>
    </span>
  );
}
