import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/motion/confirm-button";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { DemoBanner, Money, NeedStatus, ReviewerHeader, StatusPill, formatDate } from "@/components/ui";
import { requireReviewer } from "@/server/auth/access";
import { formatUsd } from "@/server/money";
import { getNeedForReviewer } from "@/server/releases/queries";
import { RETRY_AFTER_MS } from "@/server/releases/refunds";
import { notProvenAction, retryRefundAction } from "../../actions";
import { RefundForm } from "./refund-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refund - Proven", robots: { index: false, follow: false } };

// Read once per request on the server.
const requestTime = () => Date.now();

export default async function ReviewNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireReviewer();
  const { id } = await params;
  // Scope is in the query: a demo reviewer gets "not found" for real charities.
  const n = await getNeedForReviewer(reviewer, id);
  if (!n) notFound();
  const unfinished = n.refunds.find((r) => r.pending);
  const closed = ["proven", "not_proven", "cancelled"].includes(n.status);
  const canRetry = unfinished ? requestTime() - unfinished.lastUpdate > RETRY_AFTER_MS : false;

  return (
    <>
      <ReviewerHeader signOut={<SignOutButton />} />
      {reviewer.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <Link href="/review" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          Back to review queue
        </Link>
        <div className="rise-in mt-3">
          <NeedStatus status={n.status} />
          <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">{n.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{n.charityName}</p>
        </div>

        <dl className="mt-7 grid grid-cols-3 gap-3">
          {[
            { label: "Charged to donors", cents: n.chargedCents, accent: "text-ink" },
            { label: "Refunded", cents: n.refundedCents, accent: "text-proven" },
            { label: "Can be refunded", cents: n.refundableCents, accent: "text-held" },
          ].map((m, i) => (
            <div key={m.label} className="rise-in rounded-[10px] bg-[#efece4] px-4 py-3" style={{ animationDelay: `${60 + i * 60}ms` }}>
              <dt className="text-xs text-ink-muted">{m.label}</dt>
              <dd className={`mt-1 font-mono text-xl ${m.accent}`}>{formatUsd(m.cents)}</dd>
            </div>
          ))}
        </dl>

        {unfinished && !canRetry ? (
          <p role="status" className="mt-8 rounded-[10px] border border-review/30 bg-review-bg px-4 py-3 text-sm text-review-text">
            A refund of {formatUsd(unfinished.amountCents)} is on its way to PayPal. If it hasn&apos;t finished in 10 minutes, you can retry it here.
          </p>
        ) : unfinished ? (
          <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-held/30 bg-held-bg px-4 py-4 text-sm text-held-text">
            <p className="min-w-0 flex-1">A refund of {formatUsd(unfinished.amountCents)} didn&apos;t finish on PayPal. Retrying checks PayPal&apos;s record first - nothing is refunded twice.</p>
            <ConfirmButton
              label="Retry refund"
              title="Retry this refund?"
              body="Parts PayPal already refunded are recorded, not sent again."
              confirmLabel="Retry now"
              pendingLabel="Retrying..."
              cancelLabel="Not now"
              action={retryRefundAction.bind(null, n.id, unfinished.batchId)}
            />
          </section>
        ) : n.refundableCents > 0 && !closed ? (
          <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-dashed border-line px-4 py-4">
            <p className="min-w-0 flex-1 text-sm text-ink-muted">
              This need is still open. Mark it not proven first - every hold left is cancelled - then refund what was charged.
            </p>
            <ConfirmButton
              label="Mark not proven"
              tone="danger"
              title="Mark this need not proven?"
              body="Every hold still on it is cancelled and never charged. Donors get an email. Then you can refund what was already charged."
              confirmLabel="Mark not proven"
              pendingLabel="Releasing holds..."
              action={notProvenAction.bind(null, n.id)}
            />
          </section>
        ) : n.refundableCents > 0 ? (
          <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "180ms" }}>
            <h2 className="font-serif text-xl text-ink">Refund donors</h2>
            <p className="mb-5 mt-1 text-sm text-ink-muted">For when a delivery turns out to be false or overcharged. PayPal sends the money back from the charity&apos;s account to each donor.</p>
            <RefundForm needId={n.id} refundableCents={n.refundableCents} donorCount={n.gifts.filter((g) => g.chargedCents > g.refundedCents).length} />
          </section>
        ) : (
          <p className="mt-8 rounded-[10px] border border-dashed border-line px-4 py-3 text-sm text-ink-muted">Everything charged on this need has been refunded.</p>
        )}

        {n.gifts.length > 0 && (
          <section className="mt-8">
            <h2 className="font-serif text-lg text-ink">Donors</h2>
            <p className="mt-1 text-xs text-ink-muted">Anonymous - one row per gift link.</p>
            <ul className="mt-3 space-y-1.5 font-mono text-xs text-ink-soft">
              {n.gifts.map((g) => (
                <li key={g.label} className="flex justify-between gap-4 border-b border-dashed border-line pb-1.5">
                  <span>{g.label}</span>
                  <span>
                    charged <Money cents={g.chargedCents} />
                    {g.refundedCents > 0 && <span className="text-proven"> - refunded {formatUsd(g.refundedCents)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {n.refunds.length > 0 && (
          <section className="mt-8">
            <h2 className="font-serif text-lg text-ink">Refunds</h2>
            <ul className="mt-3 divide-y divide-dashed divide-line rounded-[10px] border border-line bg-card">
              {n.refunds.map((r) => (
                <li key={r.batchId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{r.reason}</span>
                    <span className="ml-2 text-xs text-ink-muted">{formatDate(r.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm">
                      {r.refundedCents === r.amountCents ? formatUsd(r.amountCents) : `${formatUsd(r.refundedCents)} of ${formatUsd(r.amountCents)}`}
                    </span>
                    <StatusPill tone={r.pending ? "held" : r.failed ? "void" : "proven"}>
                      {r.pending ? "Not finished" : r.failed ? (r.refundedCents > 0 ? "Partly refused by PayPal" : "Refused by PayPal") : "Refunded"}
                    </StatusPill>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
