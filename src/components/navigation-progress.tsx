"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin bar along the top that starts the moment someone clicks a link to
 * another page and finishes when the new page arrives - instant feedback even
 * when the server is far away or waking up.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const here = `${pathname}?${search}`;
  // When the page changes, the click that started the bar is done: forget it
  // (so returning to that page later doesn't light the bar again).
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    setLoading(null);
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or #hash
      setLoading(`${location.pathname}?${location.search.replace(/^\?/, "")}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Running from the click until the address changes.
  const active = loading !== null && loading === here;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="bar"
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-proven"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 0.85, transition: { duration: 8, ease: [0.1, 0.8, 0.2, 1] } }}
          exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.25 } }}
        />
      )}
    </AnimatePresence>
  );
}
