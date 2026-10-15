"use client";

import type { BryntumScheduler } from "@bryntum/scheduler-react";
import type { ColDef, GridApi, ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { provenGridTheme } from "@/components/grid/setup";
import type { TimelineHold, TimelineNeed } from "@/server/releases/timeline";
import NeedsTimelineInner from "./needs-timeline-inner";

const DAY = 86_400_000;
const usd = (cents: number | null | undefined) =>
  cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (p: ValueFormatterParams) => usd(p.value as number | null);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

type HoldRow = {
  id: string;
  needId: string;
  needTitle: string;
  charity: string;
  amountCents: number;
  capturedCents: number;
  remainingCents: number;
  status: "Held" | "Partly charged" | "Lapses soon";
  placed: string;
  lapses: string;
  deadline: string;
  renewed: boolean;
};

/**
 * AG Grid and Bryntum on the same records: the grid lists every live hold, the
 * timeline draws the same holds as bars. Filtering or searching the grid filters
 * the timeline; picking a row finds its bar, and clicking a bar picks its row.
 * Read-only on both sides - nothing here moves money or dates.
 */
export default function HoldsBoardInner({ needs, holds, now }: { needs: TimelineNeed[]; holds: TimelineHold[]; now: string }) {
  const scheduler = useRef<BryntumScheduler>(null);
  const [api, setApi] = useState<GridApi<HoldRow> | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const nowMs = new Date(now).getTime();

  const rows = useMemo<HoldRow[]>(() => {
    const byId = new Map(needs.map((n) => [n.id, n]));
    return holds.flatMap((h) => {
      const n = byId.get(h.needId);
      if (!n) return [];
      // The same three states as the bar colours.
      const status = (new Date(h.end).getTime() - nowMs) / DAY < 3 ? "Lapses soon" : h.capturedCents > 0 ? "Partly charged" : "Held";
      return [
        {
          id: h.id,
          needId: h.needId,
          needTitle: n.title,
          charity: n.charity,
          amountCents: h.amountCents,
          capturedCents: h.capturedCents,
          remainingCents: Math.max(0, h.amountCents - h.capturedCents),
          status,
          placed: h.start,
          lapses: h.end,
          deadline: n.deadline,
          renewed: Boolean(h.renewedUntil),
        },
      ];
    });
  }, [needs, holds, nowMs]);

  const columnDefs = useMemo<ColDef<HoldRow>[]>(
    () => [
      { field: "needTitle", headerName: "Need", minWidth: 240, flex: 2, filter: "agTextColumnFilter", pinned: "left" },
      { field: "charity", headerName: "Charity", minWidth: 200, filter: "agSetColumnFilter" },
      {
        field: "status",
        headerName: "Status",
        minWidth: 150,
        filter: "agSetColumnFilter",
        cellClass: (p) => (p.value === "Lapses soon" ? "text-[#a32d2d] font-medium" : p.value === "Partly charged" ? "text-proven-text" : "text-held-text"),
      },
      { field: "amountCents", headerName: "Held", valueFormatter: money, type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter", minWidth: 130 },
      { field: "capturedCents", headerName: "Charged", valueFormatter: money, type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter", minWidth: 130 },
      { field: "remainingCents", headerName: "Still held", valueFormatter: money, type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter", minWidth: 130 },
      { field: "placed", headerName: "Placed", valueFormatter: (p) => day(p.value as string), filter: "agDateColumnFilter", minWidth: 120 },
      { field: "lapses", headerName: "Lapses", valueFormatter: (p) => day(p.value as string), filter: "agDateColumnFilter", sort: "asc", minWidth: 120 },
      { field: "deadline", headerName: "Deliver by", valueFormatter: (p) => day(p.value as string), filter: "agDateColumnFilter", minWidth: 130 },
      { field: "renewed", headerName: "Renewed", valueFormatter: (p) => (p.value ? "Yes" : ""), filter: "agSetColumnFilter", minWidth: 120 },
    ],
    [],
  );

  /** The timeline shows exactly the holds the grid shows - and only their needs while a filter is on. */
  const syncTimeline = useCallback(() => {
    const s = scheduler.current?.instance;
    if (!api || !s) return;
    const visible = new Set<string>();
    api.forEachNodeAfterFilter((node) => node.data && visible.add(node.data.id));
    setShown(visible.size);
    s.eventStore.removeFilter("grid");
    s.resourceStore.removeFilter("grid");
    if (visible.size === rows.length) return;
    const needIds = new Set(rows.filter((r) => visible.has(r.id)).map((r) => r.needId));
    s.eventStore.filter({ id: "grid", filterBy: (e: { id: string | number }) => visible.has(String(e.id)) });
    s.resourceStore.filter({ id: "grid", filterBy: (r: { id: string | number }) => needIds.has(String(r.id)) });
  }, [api, rows]);

  /** Row picked in the grid: select its bar and bring it into view. */
  const showBar = useCallback((holdId: string) => {
    const s = scheduler.current?.instance;
    const event = s?.eventStore.getById(holdId);
    if (!s || !event) return;
    s.selectEvent(event as never);
    void s.scrollEventIntoView(event as never, { animate: true, highlight: true, block: "center" });
  }, []);

  /** Bar clicked on the timeline: select its row and bring it into view. */
  const showRow = useCallback(
    (holdId: string) => {
      const node = api?.getRowNode(holdId);
      if (!api || !node) return;
      node.setSelected(true, true);
      api.ensureNodeVisible(node, "middle");
    },
    [api],
  );

  return (
    <div className="space-y-4">
      <div className="proven-timeline overflow-hidden rounded-[10px] border border-line bg-card">
        <NeedsTimelineInner needs={needs} holds={holds} now={now} schedulerRef={scheduler} onHoldClick={showRow} />
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="holds-search" className="sr-only">
            Search holds
          </label>
          <input
            id="holds-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              api?.setGridOption("quickFilterText", e.target.value);
            }}
            maxLength={100}
            placeholder="Search holds by need or charity"
            className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)] sm:max-w-sm"
          />
          <p className="text-xs text-ink-muted" role="status">
            {shown !== null && shown < rows.length ? `Showing ${shown} of ${rows.length} holds on the grid and the timeline` : `${rows.length} live holds`}
          </p>
        </div>
        <div className="h-[420px]">
          <AgGridReact<HoldRow>
            theme={provenGridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ flex: 1, minWidth: 120, sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, tooltipValueGetter: (p) => p.valueFormatted ?? (p.value == null ? undefined : String(p.value)) }}
            tooltipShowDelay={300}
            tooltipShowMode="whenTruncated"
            getRowId={(p) => p.data.id}
            rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
            onGridReady={(e) => setApi(e.api)}
            onFirstDataRendered={syncTimeline}
            onFilterChanged={syncTimeline}
            onRowClicked={(e) => e.data && showBar(e.data.id)}
            overlayNoRowsTemplate="No holds match."
          />
        </div>
        <p className="text-[11px] text-ink-muted">Holds list by AG Grid, timeline by Bryntum Scheduler - the same holds in both. Pick a row to find its bar; click a bar to find its row.</p>
      </div>
    </div>
  );
}
