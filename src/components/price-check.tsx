import { formatUsd } from "@/server/money";
import { VERDICT_TEXT, type PriceVerdict } from "@/server/prices/price-rules";

export type PriceCheckProps = {
  verdict: PriceVerdict;
  item: string | null;
  unitCents: number | null;
  marketMedianCents: number | null;
  marketLowCents: number | null;
  marketHighCents: number | null;
  comparableCount: number;
  listings?: { title: string; unitCents: number; domain: string | null; url: string | null }[] | null;
};

const TONE: Record<PriceVerdict, string> = {
  in_line: "border-proven/30 bg-proven-bg text-proven-text",
  below: "border-proven/30 bg-proven-bg text-proven-text",
  above: "border-held/30 bg-held-bg text-held-text",
  well_above: "border-held/40 bg-held-bg text-held-text",
  unknown: "border-line bg-card text-ink-muted",
};

/**
 * The Channel3 market-price check on a need, in one line plus the numbers behind
 * it. `detailed` adds the comparable listings (charity and reviewer views).
 */
export function PriceCheck({ check, detailed = false }: { check: PriceCheckProps; detailed?: boolean }) {
  const known = check.verdict !== "unknown" && check.unitCents && check.marketMedianCents;
  return (
    <div className={`rounded-[10px] border px-4 py-3 text-sm ${TONE[check.verdict]}`}>
      <p>
        <span className="font-medium">Market price check:</span> {VERDICT_TEXT[check.verdict]}.
      </p>
      {known ? (
        <p className="mt-1 text-xs opacity-90">
          {formatUsd(check.unitCents!)} per {check.item ?? "piece"} here, against a typical {formatUsd(check.marketMedianCents!)} across {check.comparableCount} comparable listings
          {check.marketLowCents != null && check.marketHighCents != null ? ` (${formatUsd(check.marketLowCents)} to ${formatUsd(check.marketHighCents)})` : ""}.
        </p>
      ) : (
        check.item && <p className="mt-1 text-xs opacity-90">Looked for: {check.item}.</p>
      )}
      {detailed && check.listings && check.listings.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] opacity-90">
          {check.listings.map((l, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="min-w-0 truncate">
                {l.title}
                {l.domain ? ` - ${l.domain}` : ""}
              </span>
              <span className="shrink-0">{formatUsd(l.unitCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] opacity-75">An automated estimate: prices from Channel3, comparable listings picked by Claude. A high price never blocks a need - it sends releases to a reviewer.</p>
    </div>
  );
}
