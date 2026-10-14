import { Money, StatusPill, formatDate } from "@/components/ui";
import { formatUsd } from "@/server/money";
import type { ProofView } from "@/server/proofs/service";

const STATUS: Record<string, { tone: "proven" | "review" | "void" | "neutral"; label: string }> = {
  passed: { tone: "proven", label: "Checked" },
  needs_review: { tone: "review", label: "Needs a person" },
  failed: { tone: "void", label: "Didn't pass" },
  checking: { tone: "neutral", label: "Checking" },
};

const KIND: Record<string, string> = {
  receipt: "Receipt",
  supplier_confirmation: "Supplier confirmation",
  recipient_confirmation: "Recipient confirmation",
  live_photo: "Live photo",
  supplier_paypal_payment: "Supplier paid with PayPal",
};

/** Proof cards for a charity or a reviewer. Shows what the AI read and why it passed or not. */
export function ProofList({ proofs, showImages = true }: { proofs: ProofView[]; showImages?: boolean }) {
  if (proofs.length === 0) return null;
  return (
    <ul className="space-y-3">
      {proofs.map((p) => {
        const s = STATUS[p.status] ?? STATUS.checking!;
        return (
          <li key={p.id} className="rounded-[10px] border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {KIND[p.kind] ?? p.kind}
                  {p.merchant && <span className="text-ink-muted"> - {p.merchant}</span>}
                </p>
                <p className="font-mono text-xs text-ink-muted">
                  {p.purchaseDate ? `Dated ${p.purchaseDate}` : `Uploaded ${formatDate(p.createdAt)}`}
                  {p.totalCents !== null && <> - total {formatUsd(p.totalCents)}</>}
                </p>
              </div>
              <StatusPill tone={s.tone}>{s.label}</StatusPill>
            </div>

            {p.items.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-dashed border-line pt-3 font-mono text-xs text-ink-soft">
                {p.items.slice(0, 4).map((i, n) => (
                  <li key={n} className="flex justify-between gap-4">
                    <span className="min-w-0 truncate">
                      {i.quantity !== null ? `${i.quantity} x ` : ""}
                      {i.description}
                    </span>
                    {i.line_total_cents !== null && <Money cents={i.line_total_cents} />}
                  </li>
                ))}
                {p.items.length > 4 && <li className="text-ink-muted">and {p.items.length - 4} more</li>}
              </ul>
            )}

            {p.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px] text-ink-soft">
                {p.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {p.concerns.length > 0 && <p className="mt-2 text-xs text-ink-muted">Noted by the AI: {p.concerns.join("; ")}</p>}

            {showImages && p.kind === "receipt" && (
              <a
                href={`/api/proofs/${p.id}/image`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                View the receipt
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
