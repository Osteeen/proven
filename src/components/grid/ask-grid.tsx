"use client";

import type { GridApi, StructuredSchemaParams } from "ag-grid-community";
import { useState, useTransition } from "react";
import { askGridAction } from "@/app/review/actions";

/**
 * Plain-English control of a grid (AG Grid AI Toolkit): the reviewer types what
 * they want to see, Claude returns a grid state, the grid applies it. Only the
 * grid's structure goes to the AI, never its rows. "Reset view" undoes it.
 */
export function AskGrid({
  api,
  grid,
  examples,
  schemaParams,
}: {
  api: GridApi | null;
  grid: "queue" | "ledger";
  examples: string[];
  schemaParams?: StructuredSchemaParams;
}) {
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [first, setFirst] = useState<unknown>(null);
  const [pending, start] = useTransition();

  const ask = (text: string) => {
    if (!api || !text.trim()) return;
    setError(null);
    setDone(null);
    const state = api.getState();
    if (first === null) setFirst(state);
    start(async () => {
      const r = await askGridAction({ grid, request: text, schema: api.getStructuredSchema(schemaParams), state });
      if (r.error || !r.gridState) {
        setError(r.error ?? "The AI couldn't work that out. Try saying it another way.");
        return;
      }
      api.setState(r.gridState as never);
      // A new view starts with its groups open (like the grid's first load), so the rows show.
      api.forEachNode((n) => {
        if (n.group) n.setExpanded(true);
      });
      setDone(text);
    });
  };

  return (
    <div className="rounded-[10px] border border-line bg-card p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(request);
        }}
      >
        <label htmlFor={`ask-${grid}`} className="sr-only">
          Ask the grid
        </label>
        <input
          id={`ask-${grid}`}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={300}
          placeholder={`Ask the grid, e.g. "${examples[0]}"`}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]"
        />
        <button type="submit" disabled={pending || !api || !request.trim()} className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40">
          {pending ? "Arranging..." : "Ask"}
        </button>
        {first !== null && (
          <button
            type="button"
            onClick={() => {
              api?.setState(first as never);
              setDone(null);
              setError(null);
            }}
            className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            Reset view
          </button>
        )}
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <span>Try:</span>
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={pending || !api}
            onClick={() => {
              setRequest(ex);
              ask(ex);
            }}
            className="rounded-full border border-line px-2.5 py-1 text-ink-soft hover:border-ink-muted disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#791f1f]">
          {error}
        </p>
      )}
      {done && !error && (
        <p role="status" className="mt-2 text-xs text-proven-text">
          Showing: {done}. Only the view changed - no data was touched.
        </p>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">AI by Claude arranges the view from the grid&apos;s columns and your current view settings - it never sees the rows or changes anything.</p>
    </div>
  );
}
