import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { ConfirmButton } from "@/components/motion/confirm-button";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { CharityHeader, DemoBanner, Money, NeedStatus, StatusPill, formatDate } from "@/components/ui";
import { requireCharity } from "@/server/auth/access";
import { formatUsd } from "@/server/money";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { getNeedForCharity } from "@/server/releases/queries";
import { cancelNeedAction } from "./actions";
import { ReleaseForm } from "./release-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage need - Proven" };

const RELEASE_STATUS: Record<string, { tone: "held" | "proven" | "void" | "review" | "neutral"; label: string }> = {
  pending_review: { tone: "review", label: "Waiting for review" },
  approved: { tone: "review", label: "Approved - sending to PayPal" },
  executing: { tone: "review", label: "Sending to PayPal" },
  completed: { tone: "proven", label: "Paid" },
  failed: { tone: "held", label: "PayPal didn't finish - retry pending" },
  rejected: { tone: "void", label: "Not approved" },
};

const HOLD_STATUS: Record<string, string> = {
  authorized: "Held",
  partially_captured: "Partly charged",
  captured: "Charged",
  voided: "Released",
  expired: "Lapsed",
};

export default async function ManageNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCharity();
  const { id } = await params;
  // Ownership is in the query: another charity's need is simply not found.
  const n = await getNeedForCharity(ctx, id);
  if (!n) notFound();

  const open = n.status === "open";
  const closable = ["open", "in_review", "funded", "delivering"].includes(n.status);
  const liveDonors = n.liveDonors;

  return (
    <>
      <CharityHeader signOut={<SignOutButton />} />
      {ctx.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <Link href="/dashboard" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          Back to dashboard
        </Link>
        <div className="rise-in mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <NeedStatus status={n.status} />
            <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">{n.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              <Money cents={n.amountCents} /> - deliver by {formatDate(n.deadline)} - proof: {n.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(", ")}
            </p>
          </div>
          <Link href={`/needs/${n.id}`} className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            View public page
          </Link>
        </div>

        <dl className="mt-7 grid grid-cols-3 gap-3">
          {[
            { label: "Held, not charged", cents: n.heldCents, accent: "text-held" },
            { label: "Paid to you", cents: n.chargedCents - n.refundedCents, accent: "text-proven" },
            { label: "Released to donors", cents: n.releasedCents, accent: "text-ink-muted" },
          ].map((m, i) => (
            <div key={m.label} className="rise-in rounded-[10px] bg-[#efece4] px-4 py-3" style={{ animationDelay: `${60 + i * 60}ms` }}>
              <dt className="text-xs text-ink-muted">{m.label}</dt>
              <dd className={`mt-1 text-xl ${m.accent}`}>
                <AnimatedMoney cents={m.cents} delay={0.1 + i * 0.08} />
              </dd>
            </div>
          ))}
        </dl>
        {n.refundedCents > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            {formatUsd(n.refundedCents)} of what was paid to you was refunded to donors by a Proven reviewer.
          </p>
        )}
        {n.firstHoldExpiresAt && n.heldCents > 0 && (
          <p className="mt-2 text-xs text-ink-muted">The first hold lapses on {formatDate(n.firstHoldExpiresAt)} if nothing is released.</p>
        )}

        {open && n.heldCents > 0 && !n.inFlight && (
          <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "180ms" }}>
            <h2 className="font-serif text-xl text-ink">Release money</h2>
            <p className="mb-5 mt-1 text-sm text-ink-muted">
              PayPal pays you directly from donors&apos; holds. Only what you release is charged.
            </p>
            <ReleaseForm
              needId={n.id}
              heldCents={n.heldCents}
              advanceLeftCents={n.advanceLeftCents}
              staged={n.fundingModel === "staged"}
              donorCount={liveDonors}
              trustTier={n.trustTier}
              completedReleases={n.completedReleases}
              thresholdCents={n.thresholdCents}
            />
          </section>
        )}
        {open && n.heldCents === 0 && (
          <p className="mt-8 rounded-[10px] border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
            Nothing is held yet. Share the public page - you can release money once donors hold some.
          </p>
        )}
        {n.inFlight && (
          <p className="mt-8 rounded-[10px] border border-review/30 bg-review-bg px-4 py-3 text-sm text-review-text" role="status">
            {n.inFlight.status === "pending_review"
              ? `A release of ${formatUsd(n.inFlight.amountCents)} is waiting for a reviewer. Nothing is charged until it's approved.`
              : n.inFlight.status === "failed"
                ? `A release of ${formatUsd(n.inFlight.amountCents)} didn't finish on PayPal. A reviewer will retry it - nothing is charged twice.`
                : `A release of ${formatUsd(n.inFlight.amountCents)} is being sent to PayPal.`}
          </p>
        )}

        {n.releases.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "240ms" }}>
            <h2 className="font-serif text-lg text-ink">Releases</h2>
            <ul className="mt-3 divide-y divide-dashed divide-line rounded-[10px] border border-line bg-card">
              {n.releases.map((r) => {
                const s = RELEASE_STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="text-ink">{r.kind === "advance" ? "Booking payment" : "Delivery release"}</span>
                      <span className="ml-2 text-xs text-ink-muted">{formatDate(r.createdAt)}</span>
                      {r.reviewReason && r.status === "pending_review" && <span className="block text-xs text-ink-muted">{r.reviewReason}</span>}
                      {r.note && <span className="block truncate text-xs text-ink-muted">{r.note}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <Money cents={r.amountCents} />
                      <StatusPill tone={s.tone}>{s.label}</StatusPill>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {n.holds.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "300ms" }}>
            <h2 className="font-serif text-lg text-ink">Holds</h2>
            <p className="mt-1 text-xs text-ink-muted">Donors stay anonymous to charities.</p>
            <ul className="mt-3 space-y-1.5 font-mono text-xs text-ink-soft">
              {n.holds.map((h) => (
                <li key={h.key} className="flex justify-between gap-4 border-b border-dashed border-line pb-1.5">
                  <span>
                    {h.label}
                    {h.at ? ` - ${formatDate(h.at)}` : ""}
                  </span>
                  <span>
                    <Money cents={h.amountCents} />
                    {h.capturedCents - h.refundedCents > 0 && h.capturedCents < h.amountCents && <span className="text-proven"> ({formatUsd(h.capturedCents - h.refundedCents)} paid)</span>}
                    {h.refundedCents > 0 && <span className="text-ink-muted"> ({formatUsd(h.refundedCents)} refunded)</span>}{" "}
                    <span className="text-ink-muted">{HOLD_STATUS[h.status] ?? h.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {closable && (
          <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-dashed border-line px-4 py-4">
            <p className="min-w-0 flex-1 text-sm text-ink-muted">
              Can&apos;t deliver this? Close it and every hold is cancelled - donors are never charged for it.
            </p>
            <ConfirmButton
              label="Close need"
              tone="danger"
              title="Close this need?"
              body={
                <>
                  {n.heldCents > 0 ? `${formatUsd(n.heldCents)} held for ${liveDonors} ${liveDonors === 1 ? "donor" : "donors"} is released and never charged.` : "Nothing is held right now."}
                  {n.chargedCents - n.refundedCents > 0 ? ` The ${formatUsd(n.chargedCents - n.refundedCents)} already paid for the booking stays paid.` : ""} Donors get an email. This can&apos;t be undone.
                </>
              }
              confirmLabel="Close and release holds"
              pendingLabel="Closing..."
              action={cancelNeedAction.bind(null, n.id)}
            />
          </section>
        )}
      </main>
    </>
  );
}
