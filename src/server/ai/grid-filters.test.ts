import { describe, expect, it } from "vitest";
import { dropEmptyFilters } from "./grid-filters";

describe("Ask the grid: empty placeholder filters", () => {
  it("keeps the filter the request asked for and drops the empty ones", () => {
    const blank = { filterType: "number", type: "blank", filter: null, filterTo: null };
    const out = dropEmptyFilters({
      filter: {
        filterModel: {
          need: { filterType: "set", values: [] },
          event: { filterType: "set", values: ["Charged"] },
          charged: { filterType: "number", operator: "AND", conditions: [blank, blank] },
          held: { filterType: "number", type: "greaterThan", filter: 0 },
          at: { filterType: "date", type: "inRange", dateFrom: "2026-10-01", dateTo: null },
          actor: null,
        },
      },
      sort: { sortModel: [{ colId: "charged", sort: "desc" }] },
    });
    expect(Object.keys((out.filter as { filterModel: object }).filterModel).sort()).toEqual(["at", "event", "held"]);
    expect(out.sort).toEqual({ sortModel: [{ colId: "charged", sort: "desc" }] });
  });

  it("leaves a state without filters alone", () => {
    expect(dropEmptyFilters({ sort: { sortModel: [] } })).toEqual({ sort: { sortModel: [] } });
  });
});
