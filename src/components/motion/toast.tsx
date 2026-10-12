"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

/** A confirmation that springs in, then gets out of the way after a few seconds. */
export function Toast({ children, ms = 5000 }: { children: React.ReactNode; ms?: number }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [ms]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
          transition={{ type: "spring", stiffness: 420, damping: 26 }}
          className="mt-6 flex items-center gap-3 rounded-md border border-proven/30 bg-proven-bg px-4 py-3 text-sm text-proven-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <motion.circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
            <motion.path d="M7.5 12.5 L10.5 15.5 L16.5 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.35 }} />
          </svg>
          <span>{children}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
