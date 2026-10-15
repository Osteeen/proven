"use client";

import dynamic from "next/dynamic";
import type { TimelineHold, TimelineNeed } from "@/server/releases/timeline";
import { TimelineLegend } from "./needs-timeline";

// Bryntum and the linked grid draw with browser APIs, so they load in the browser only.
const Inner = dynamic(() => import("./holds-board-inner"), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-[10px] border border-line bg-card" />,
});

/** The reviewers' holds timeline (Bryntum) linked to a holds list (AG Grid) on the same records. */
export function HoldsBoard({ needs, holds, now }: { needs: TimelineNeed[]; holds: TimelineHold[]; now: string }) {
  if (needs.length === 0) return <p className="rounded-[10px] border border-dashed border-line px-4 py-6 text-sm text-ink-muted">No live needs right now.</p>;
  return (
    <div className="space-y-2">
      <TimelineLegend />
      <Inner needs={needs} holds={holds} now={now} />
    </div>
  );
}
