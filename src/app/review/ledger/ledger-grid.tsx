"use client";

import type { ColDef, GridApi, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo, useState } from "react";
import { AskGrid } from "@/components/grid/ask-grid";
import { provenGridTheme } from "@/components/grid/setup";
import type { LedgerRow } from "@/server/releases/ledger";

const EVENT_LABEL: Record<string, string> = {
  authorized: "Held",
  reauthorized: "Hold renewed",
  capture_requested: "Charge requested",
  captured: "Charged",
  capture_failed: "Charge failed",
  voided: "Released",
  expired: "Lapsed",
  refunded: "Refunded",
};
const ACTOR_LABEL: Record<string, string> = { system: "Proven", reviewer: "Reviewer", charity: "Charity", donor: "Donor", paypal_webhook: "PayPal" };

/** A code's label; blank on group and total rows, which have no single value. */
const label = (labels: Record<string, string>, v: unknown) => (v == null || v === "" ? "" : (labels[v as string] ?? String(v)));

const usd = (cents: number | null | undefined) =>
  cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (p: ValueFormatterParams) => usd(p.value as number | null);

/** One money column per kind of movement, so sums are real totals (a "charge requested" row is not money moved). */
const amountFor = (events: string[]) => (p: ValueGetterParams<LedgerRow>) => (p.data && events.includes(p.data.event) ? p.data.amountCents : null);

/**
 * The money ledger (AG Grid Enterprise): every hold, charge, release and refund.
 * Grouped by charity with totals, set filters, a column tool panel, Excel export,
 * and plain-English view control (AI Toolkit).
 */
export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const [api, setApi] = useState<GridApi | null>(null);
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "charity", headerName: "Charity", rowGroup: true, hide: true, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "need", headerName: "Need", filter: "agSetColumnFilter", enableRowGroup: true, minWidth: 280, flex: 2 },
      {
        field: "at",
        headerName: "When",
        sort: "desc",
        filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""),
        filterParams: { comparator: (day: Date, cell: string) => new Date(new Date(cell).toDateString()).getTime() - day.getTime() },
        minWidth: 160,
      },
      { field: "event", headerName: "What happened", filter: "agSetColumnFilter", enableRowGroup: true, valueFormatter: (p) => label(EVENT_LABEL, p.value), filterParams: { valueFormatter: (p: ValueFormatterParams) => label(EVENT_LABEL, p.value) }, minWidth: 180 },
      { colId: "held", headerName: "Held", valueGetter: amountFor(["authorized"]), valueFormatter: money, aggFunc: "sum", type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter" },
      { colId: "charged", headerName: "Charged", valueGetter: amountFor(["captured"]), valueFormatter: money, aggFunc: "sum", type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter" },
      { colId: "released", headerName: "Released", valueGetter: amountFor(["voided", "expired"]), valueFormatter: money, aggFunc: "sum", type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter" },
      { colId: "refunded", headerName: "Refunded", valueGetter: amountFor(["refunded"]), valueFormatter: money, aggFunc: "sum", type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter" },
      { field: "donation", headerName: "Donation", filter: "agTextColumnFilter", minWidth: 140 },
      { field: "actor", headerName: "By", filter: "agSetColumnFilter", enableRowGroup: true, valueFormatter: (p) => label(ACTOR_LABEL, p.value), filterParams: { valueFormatter: (p: ValueFormatterParams) => label(ACTOR_LABEL, p.value) } },
      { field: "paypalReference", headerName: "PayPal reference", filter: "agTextColumnFilter", hide: true, minWidth: 180 },
    ],
    [],
  );
  const defaultColDef = useMemo<ColDef>(() => ({ flex: 1, minWidth: 140, sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, tooltipValueGetter: (p) => (p.valueFormatted ?? (p.value == null ? undefined : String(p.value))) }), []);
  const exportExcel = useCallback(() => api?.exportDataAsExcel({ fileName: "proven-ledger.xlsx" }), [api]);

  return (
    <div className="space-y-3">
      <AskGrid
        api={api}
        grid="ledger"
        examples={["Only charges, biggest first", "Group by need instead of charity", "Show refunds and releases only"]}
        // The AI may see the event and actor filter options (fixed words), never charities' or donations' values.
        schemaParams={{ columns: { event: { includeSetValues: true, description: "What happened: Held, Hold renewed, Charge requested, Charged, Charge failed, Released, Lapsed, Refunded" }, actor: { includeSetValues: true } } }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">{rows.length.toLocaleString("en-US")} entries. Drag a column header to the bar above the grid to group by it.</p>
        <button type="button" onClick={exportExcel} disabled={!api} className="rounded-full border border-ink px-4 py-1.5 text-sm text-ink hover:bg-[#eef1f7] disabled:opacity-40">
          Export to Excel
        </button>
      </div>
      <div style={{ height: 680 }}>
        <AgGridReact<LedgerRow>
          theme={provenGridTheme}
          tooltipShowDelay={300}
          tooltipShowMode="whenTruncated"
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          autoGroupColumnDef={{ headerName: "Charity", minWidth: 320, pinned: "left" }}
          groupDefaultExpanded={1}
          grandTotalRow="bottom"
          suppressAggFuncInHeader
          suppressGroupRowsSticky
          rowGroupPanelShow="onlyWhenGrouping"
          sideBar={{ toolPanels: ["columns", "filters"], defaultToolPanel: "" }}
          statusBar={{ statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] }}
          cellSelection
          onGridReady={(e) => setApi(e.api)}
        />
      </div>
    </div>
  );
}
