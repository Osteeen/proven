"use client";

import type { ColDef, GridApi, ICellRendererParams, ValueFormatterParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AskGrid } from "@/components/grid/ask-grid";
import { provenGridTheme } from "@/components/grid/setup";
import { PriceCheck, type PriceCheckProps } from "@/components/price-check";
import { ProofList } from "@/components/proof-list";
import type { ProofView } from "@/server/proofs/service";
import { approveAction, notProvenAction, rejectAction } from "./actions";

export type QueueRow = {
  id: string;
  needId: string;
  needTitle: string;
  charityName: string;
  trustTier: string;
  kind: "advance" | "final";
  amountCents: number;
  needAmountCents: number;
  heldCents: number;
  deadline: string;
  createdAt: string;
  reviewReason: string | null;
  note: string | null;
  requiredProof: string;
  proofs: ProofView[];
  price: PriceCheckProps | null;
};

const PRICE_SHORT: Record<string, string> = { in_line: "In line", below: "Below market", above: "Above market", well_above: "Well above market", unknown: "Not checked" };

const usd = (cents: number | null | undefined) =>
  cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (p: ValueFormatterParams) => usd(p.value as number | null);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "3 passed, 1 in doubt" - the proof at a glance. */
function checks(proofs: ProofView[]) {
  const passed = proofs.filter((p) => p.status === "passed").length;
  const doubt = proofs.filter((p) => p.status === "needs_review" || p.status === "failed").length;
  if (proofs.length === 0) return "No proof yet";
  return [passed && `${passed} passed`, doubt && `${doubt} in doubt`, proofs.length - passed - doubt > 0 && `${proofs.length - passed - doubt} checking`].filter(Boolean).join(", ");
}

/**
 * The review queue (AG Grid Enterprise): one row per release waiting for a
 * person, groupable by charity, with plain-English view control. Expanding a row
 * shows its proof and the decision, confirmed in place - no popups over the grid.
 */
export function QueueGrid({ rows }: { rows: QueueRow[] }) {
  const [api, setApi] = useState<GridApi | null>(null);
  // Six columns fit the page without sideways scrolling; trust, held, checks and dates are one
  // click away in the Columns panel (and shown in each opened row).
  const columnDefs = useMemo<ColDef<QueueRow>[]>(
    () => [
      { field: "needTitle", headerName: "Need", cellRenderer: "agGroupCellRenderer", minWidth: 220, flex: 2, filter: "agTextColumnFilter", pinned: "left" },
      { field: "charityName", headerName: "Charity", enableRowGroup: true, filter: "agSetColumnFilter", minWidth: 170 },
      { field: "trustTier", headerName: "Trust", enableRowGroup: true, filter: "agSetColumnFilter", minWidth: 120, hide: true },
      {
        field: "kind",
        headerName: "Type",
        enableRowGroup: true,
        filter: "agSetColumnFilter",
        valueFormatter: (p) => (p.value == null ? "" : p.value === "advance" ? "Booking payment" : "Delivery payment"),
        minWidth: 150,
        filterParams: { valueFormatter: (p: ValueFormatterParams) => (p.value == null ? "" : p.value === "advance" ? "Booking payment" : "Delivery payment") },
      },
      { field: "amountCents", headerName: "Amount", valueFormatter: money, aggFunc: "sum", type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter", sort: "desc", minWidth: 120 },
      { field: "heldCents", headerName: "Held now", valueFormatter: money, type: "rightAligned", cellClass: "grid-money", filter: "agNumberColumnFilter", minWidth: 130, hide: true },
      { field: "reviewReason", headerName: "Why a person", enableRowGroup: true, filter: "agSetColumnFilter", minWidth: 200, flex: 2, valueFormatter: (p) => (p.node?.group ? "" : ((p.value as string) ?? "Needs review")) },
      {
        colId: "price",
        headerName: "Market price",
        enableRowGroup: true,
        filter: "agSetColumnFilter",
        minWidth: 140,
        valueGetter: (p) => (p.data ? PRICE_SHORT[p.data.price?.verdict ?? "unknown"] : ""),
        cellClass: (p) => (p.data?.price?.verdict === "well_above" || p.data?.price?.verdict === "above" ? "text-held-text font-medium" : ""),
      },
      { colId: "checks", headerName: "Checks", valueGetter: (p) => (p.data ? checks(p.data.proofs) : ""), filter: "agTextColumnFilter", minWidth: 160, hide: true },
      { field: "deadline", headerName: "Deliver by", valueFormatter: (p) => (p.value ? day(p.value as string) : ""), filter: "agDateColumnFilter", minWidth: 120, hide: true },
      { field: "createdAt", headerName: "Asked", valueFormatter: (p) => (p.value ? day(p.value as string) : ""), minWidth: 120, hide: true },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <AskGrid
        api={api}
        grid="queue"
        examples={["Biggest first, new charities only", "Group by charity", "Only delivery payments"]}
        schemaParams={{ columns: { kind: { includeSetValues: true, description: "advance = booking payment, final = delivery payment" }, trustTier: { includeSetValues: true }, reviewReason: { includeSetValues: true }, price: { includeSetValues: true, description: "Channel3 market price check of the need" } } }}
      />
      {/* Grows with its rows and any opened detail, so nothing is cut off. */}
      <div>
        <AgGridReact<QueueRow>
          theme={provenGridTheme}
          tooltipShowDelay={300}
          tooltipShowMode="whenTruncated"
          domLayout="autoHeight"
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ flex: 1, minWidth: 140, sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, tooltipValueGetter: (p) => (p.valueFormatted ?? (p.value == null ? undefined : String(p.value))) }}
          getRowId={(p) => p.data.id}
          masterDetail
          detailRowAutoHeight
          detailCellRenderer={ReleaseDetail}
          rowGroupPanelShow="onlyWhenGrouping"
          suppressAggFuncInHeader
          suppressGroupRowsSticky
          groupDefaultExpanded={1}
          autoGroupColumnDef={{ minWidth: 220 }}
          sideBar={{ toolPanels: ["columns", "filters"], defaultToolPanel: "" }}
          statusBar={{ statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] }}
          onGridReady={(e) => setApi(e.api)}
        />
      </div>
    </div>
  );
}

/** A release's proof and the decision, inside the grid. */
function ReleaseDetail({ data: r }: ICellRendererParams<QueueRow>) {
  if (!r) return null;
  return (
    <div className="space-y-4 bg-paper px-6 py-5 text-sm whitespace-normal">
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-xs [&>dd]:text-right [&>dt]:text-ink-muted">
        <dt>Need</dt>
        <dd>{usd(r.needAmountCents)}</dd>
        <dt>Held now</dt>
        <dd>{usd(r.heldCents)}</dd>
        <dt>{r.kind === "advance" ? "Stays held" : "Never charged"}</dt>
        <dd className="text-proven">{usd(Math.max(0, r.heldCents - r.amountCents))}</dd>
        <dt>Proof required</dt>
        <dd>{r.requiredProof}</dd>
      </dl>
      {r.note && <p className="rounded-md bg-[#efece4] px-3 py-2 text-ink-soft">&ldquo;{r.note}&rdquo;</p>}
      {r.price && <div className="max-w-3xl"><PriceCheck check={r.price} detailed /></div>}
      <div>
        <p className="text-xs text-ink-muted">Proof on this need</p>
        {r.proofs.length === 0 ? <p className="mt-1 text-ink-soft">No proof uploaded yet.</p> : <div className="mt-2 max-w-3xl"><ProofList proofs={r.proofs} /></div>}
      </div>
      <Decide r={r} />
    </div>
  );
}

type Choice = "approve" | "reject" | "not_proven";

/** The decision, confirmed in place: the chosen button turns into "Sure? Yes / Cancel". */
function Decide({ r }: { r: QueueRow }) {
  const router = useRouter();
  const [asking, setAsking] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const copy: Record<Choice, { ask: string; yes: string; busy: string }> = {
    approve: {
      ask:
        r.kind === "final"
          ? `PayPal pays ${r.charityName} ${usd(r.amountCents)} from donors' holds, in proportion; the rest of every hold is cancelled.`
          : `PayPal pays ${r.charityName} ${usd(r.amountCents)} now; the rest stays held until delivery.`,
      yes: "Approve and pay",
      busy: "Paying...",
    },
    reject: { ask: "Nothing is charged. The need reopens so the charity can send a corrected request.", yes: "Send back", busy: "Sending back..." },
    not_proven: { ask: `Every hold is cancelled - ${usd(r.heldCents)} is never charged. Donors get an email.`, yes: "Mark not proven", busy: "Releasing holds..." },
  };
  const run = (c: Choice) =>
    start(async () => {
      setError(null);
      const res = c === "approve" ? await approveAction(r.id) : c === "reject" ? await rejectAction(r.id) : await notProvenAction(r.needId);
      if (res.error) setError(res.error);
      else {
        setAsking(null);
        router.refresh();
      }
    });

  if (asking) {
    const c = copy[asking];
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-card px-4 py-3">
        <p className="min-w-0 flex-1 text-ink-soft">{c.ask}</p>
        <button type="button" disabled={pending} onClick={() => setAsking(null)} className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink">
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(asking)}
          className={`rounded-full px-4 py-2 text-sm text-paper disabled:opacity-50 ${asking === "approve" ? "bg-ink" : "bg-[#a32d2d]"}`}
        >
          {pending ? c.busy : c.yes}
        </button>
        {error && <p role="alert" className="w-full text-xs text-[#791f1f]">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {r.kind === "final" && (
        <button type="button" onClick={() => setAsking("not_proven")} className="mr-auto rounded-full border border-[#f09595] px-4 py-2 text-sm text-[#a32d2d]">
          Not proven
        </button>
      )}
      <button type="button" onClick={() => setAsking("reject")} className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:border-ink-muted">
        Send back
      </button>
      <button type="button" onClick={() => setAsking("approve")} className="rounded-full bg-ink px-4 py-2 text-sm text-paper">
        Approve {usd(r.amountCents)}
      </button>
      {error && <p role="alert" className="w-full text-xs text-[#791f1f]">{error}</p>}
    </div>
  );
}
