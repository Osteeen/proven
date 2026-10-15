"use client";

import dynamic from "next/dynamic";
import type { TimelineHold, TimelineNeed } from "@/server/releases/timeline";

// Bryntum draws with browser APIs, so it loads in the browser only.
const Inner = dynamic(() => import("./needs-timeline-inner"), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-[10px] border border-line bg-card" />,
});

/** The holds timeline (Bryntum Scheduler), with a legend. */
export function NeedsTimeline({ needs, holds, now }: { needs: TimelineNeed[]; holds: TimelineHold[]; now: string }) {
  if (needs.length === 0) return <p className="rounded-[10px] border border-dashed border-line px-4 py-6 text-sm text-ink-muted">No live needs right now.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <Key color="#b26b00">Held, not charged</Key>
        <Key color="#1f7a4d">Partly charged</Key>
        <Key color="#a32d2d">Lapses within 3 days</Key>
        <Key color="#1d4ed8">Delivery deadline</Key>
      </div>
      <div className="proven-timeline overflow-hidden rounded-[10px] border border-line bg-card">
        <Inner needs={needs} holds={holds} now={now} />
      </div>
      <p className="text-[11px] text-ink-muted">Timeline by Bryntum Scheduler. Each bar is one donor&apos;s hold, from the day PayPal placed it until it lapses 29 days later.</p>
    </div>
  );
}

function Key({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}
