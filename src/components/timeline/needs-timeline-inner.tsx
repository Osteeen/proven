"use client";

import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import { BryntumScheduler } from "@bryntum/scheduler-react";
import { type Ref, useMemo } from "react";
import type { TimelineHold, TimelineNeed } from "@/server/releases/timeline";

const DAY = 86_400_000;
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Bryntum Scheduler: one row per need, one bar per donor hold, from the day PayPal
 * placed it to the day it lapses (29 days later). The delivery deadline is marked on
 * each row and today is a line, so a need running out of time - deadline or holds
 * close to lapsing - stands out. Read-only: it shows, it never moves money.
 */
export default function NeedsTimelineInner({
  needs,
  holds,
  now,
  schedulerRef,
  onHoldClick,
}: {
  needs: TimelineNeed[];
  holds: TimelineHold[];
  now: string;
  /** For a page that drives the timeline (the linked holds grid). */
  schedulerRef?: Ref<BryntumScheduler>;
  onHoldClick?: (holdId: string) => void;
}) {
  const nowMs = new Date(now).getTime();
  const props = useMemo(() => {
    const resources = needs.map((n) => ({ id: n.id, name: n.title, charity: n.charity }));
    const events = holds.map((h) => {
      const daysLeft = (new Date(h.end).getTime() - nowMs) / DAY;
      const charged = h.capturedCents > 0;
      return {
        id: h.id,
        resourceId: h.needId,
        startDate: new Date(h.start),
        endDate: new Date(h.end),
        name: charged ? `${usd(h.capturedCents)} of ${usd(h.amountCents)} paid` : `${usd(h.amountCents)} held`,
        // Red: lapses within 3 days. Green: partly charged. Amber: held.
        eventColor: daysLeft < 3 ? "#a32d2d" : charged ? "#1f7a4d" : "#b26b00",
        lapses: date(h.end),
        renewed: h.renewedUntil ? date(h.renewedUntil) : null,
      };
    });
    const resourceTimeRanges = needs.map((n) => ({
      id: `deadline-${n.id}`,
      resourceId: n.id,
      startDate: new Date(new Date(n.deadline).getTime() - DAY + 1000),
      endDate: new Date(n.deadline),
      // A plain band (the legend names it): a label in a one-day band is just a clipped letter.
      name: "",
      cls: "deadline-band",
    }));
    const earliest = Math.min(nowMs - 7 * DAY, ...holds.map((h) => new Date(h.start).getTime()));
    return {
      resources,
      events,
      resourceTimeRanges,
      startDate: new Date(earliest - DAY),
      endDate: new Date(nowMs + 30 * DAY),
    };
  }, [needs, holds, nowMs]);

  return (
    <BryntumScheduler
      ref={schedulerRef}
      onEventClick={onHoldClick ? ({ eventRecord }: { eventRecord: { id: string | number } }) => onHoldClick(String(eventRecord.id)) : undefined}
      height={Math.min(560, 120 + needs.length * 64)}
      readOnly
      rowHeight={56}
      barMargin={8}
      viewPreset="weekAndDayLetter"
      startDate={props.startDate}
      endDate={props.endDate}
      resources={props.resources}
      events={props.events}
      resourceTimeRanges={props.resourceTimeRanges}
      columns={[
        // Need titles are typed by charities: always shown as text, never as HTML.
        // Hover a cut-off name to read it in full.
        { text: "Need", field: "name", width: 260, htmlEncode: true, tooltipRenderer: ({ record }: { record: { get: (k: string) => string } }) => record.get("name") },
        { text: "Charity", field: "charity", width: 170, htmlEncode: true, tooltipRenderer: ({ record }: { record: { get: (k: string) => string } }) => record.get("charity") },
      ]}
      timeRangesFeature={{ showCurrentTimeLine: { name: "Today" } }}
      resourceTimeRangesFeature
      cellTooltipFeature
      eventTooltipFeature={{
        template: ({ eventRecord }: { eventRecord: { name: string; startDate: Date; get: (k: string) => string | null } }) =>
          `<div style="font-size:13px;line-height:1.5"><b>${eventRecord.name}</b><br>Placed ${date(eventRecord.startDate.toISOString())}<br>Lapses ${eventRecord.get("lapses")} if not charged${eventRecord.get("renewed") ? `<br>Renewed with PayPal` : ""}<br><span style="opacity:.7">Donor stays anonymous</span></div>`,
      }}
      cellMenuFeature={false}
      headerMenuFeature={false}
      eventMenuFeature={false}
      scheduleMenuFeature={false}
    />
  );
}
