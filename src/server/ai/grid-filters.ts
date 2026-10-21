/**
 * AG Grid's structured schema marks every column's filter as required, so the model
 * fills columns the request never mentioned with empty placeholders: a set filter
 * with no values (which hides every row) or "blank" conditions with no value. Only
 * filters that actually say something are kept.
 */
type Model = Record<string, unknown>;

function says(f: unknown): boolean {
  if (!f || typeof f !== "object") return false;
  const m = f as Model;
  if (Array.isArray(m.conditions)) return m.conditions.some(says);
  if (m.filterType === "set") return Array.isArray(m.values) && m.values.length > 0;
  return ["filter", "filterTo", "dateFrom", "dateTo"].some((k) => m[k] !== null && m[k] !== undefined && m[k] !== "");
}

/** The grid state with empty placeholder filters removed. */
export function dropEmptyFilters<T extends Model>(state: T): T {
  const filter = state.filter as { filterModel?: Model } | null | undefined;
  if (!filter || typeof filter !== "object" || !filter.filterModel || typeof filter.filterModel !== "object") return state;
  const kept = Object.fromEntries(Object.entries(filter.filterModel).filter(([, f]) => says(f)));
  return { ...state, filter: { ...filter, filterModel: kept } };
}
