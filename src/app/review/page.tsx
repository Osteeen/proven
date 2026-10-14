import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmButton } from "@/components/motion/confirm-button";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { DemoBanner, Money, ReviewerHeader, StatusPill, formatDate } from "@/components/ui";
import { requireReviewer } from "@/server/auth/access";
import { formatUsd } from "@/server/money";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { ProofList } from "@/components/proof-list";
import { listProofsForNeed } from "@/server/proofs/service";
import { listRefundableNeeds, listReviewQueue, listWebhookAlerts } from "@/server/releases/queries";
import { listSuppliersToVerify, listVerifiedSuppliers, listWithdrawnProofNeeds } from "@/server/suppliers/service";
import { approveAction, finishClosingAction, notProvenAction, rejectAction, rejectSupplierAction, retryAction, revokeSupplierAction, verifySupplierAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review queue - Proven", robots: { index: false, follow: false } };

// Read once per request on the server, to tell a stopped release from a running one.
const requestTime = () => new Date();

export default async function ReviewPage() {
  const reviewer = await requireReviewer();
  const [queue, refundable, alerts, toVerify, withdrawn, verified] = await Promise.all([
    listReviewQueue(reviewer, requestTime()),
    listRefundableNeeds(reviewer),
    listWebhookAlerts(reviewer),
    listSuppliersToVerify(reviewer),
    listWithdrawnProofNeeds(reviewer),
    listVerifiedSuppliers(reviewer),
  ]);
  // Proof for each waiting release (the queue is already limited to charities this reviewer may see).
  const proofsByNeed = new Map(
    await Promise.all(
      [...new Set(queue.releases.filter((r) => r.status === "pending_review").map((r) => r.needId))].map(async (id) => [id, await listProofsForNeed(reviewer, id)] as const),
    ),
  );
  const waiting = queue.releases.filter((r) => r.status === "pending_review");
  const failed = queue.releases.filter((r) => r.status !== "pending_review");

  return (
    <>
      <ReviewerHeader signOut={<SignOutButton />} />
      {reviewer.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-4xl px-4 pb-20 pt-8 sm:px-6">
        <div className="rise-in">
          <p className="text-sm text-ink-muted">Review queue</p>
          <h1 className="font-serif text-3xl text-ink">
            {waiting.length === 0 ? "Nothing waiting" : `${waiting.length} ${waiting.length === 1 ? "release" : "releases"} to check`}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            Every delivery release waits here for now, along with new charities&apos; first release and anything above a charity&apos;s limit. Nothing is charged until you approve.
          </p>
        </div>

        {alerts.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "60ms" }}>
            <h2 className="font-serif text-lg text-ink">PayPal reported something we didn&apos;t expect</h2>
            <p className="mt-1 text-xs text-ink-muted">For example a refund made outside Proven or a reversed charge. Check it on PayPal; our totals don&apos;t include it yet.</p>
            <ul className="mt-3 space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-[10px] border border-held/30 bg-held-bg px-4 py-3 font-mono text-xs text-held-text">
                  <span>{a.eventType} - {a.resourceId ?? "no id"}</span>
                  <span>{formatDate(a.receivedAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {withdrawn.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "65ms" }}>
            <h2 className="font-serif text-lg text-ink">Proof withdrawn after release</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-muted">
              Donors were charged more than the supplier payments that still stand - a supplier refunded, the charity disputed a payment, or a supplier was rejected. Check it, and refund donors if the delivery isn&apos;t real.
            </p>
            <ul className="mt-3 space-y-2">
              {withdrawn.map((w) => (
                <li key={w.needId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[10px] border border-held/30 bg-held-bg px-4 py-3 text-sm text-held-text">
                  <span className="min-w-0">
                    <Link href={`/review/needs/${w.needId}`} className="underline decoration-held/40 underline-offset-4 hover:decoration-held-text">
                      {w.needTitle}
                    </Link>
                    <span className="block text-xs">{w.charityName}</span>
                  </span>
                  <span className="font-mono text-xs">
                    charged {formatUsd(w.releasedCents)} - supplier payments standing {formatUsd(w.supplierPaidCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {toVerify.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "70ms" }}>
            <h2 className="font-serif text-lg text-ink">Suppliers to verify</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-muted">
              Find the business yourself - its website or a public listing, not details from the charity - and check it matches the name PayPal holds. Once verified, payments to it pass on their own.
            </p>
            <ul className="mt-3 space-y-3">
              {toVerify.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line bg-card px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-muted">
                      PayPal name: {s.paypalName ?? "not known yet"}
                      {s.country ? ` (${s.country})` : ""} - {s.email}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      Invited by {s.invitedBy ?? "Proven"}
                      {s.paidCents > 0 ? ` - ${formatUsd(s.paidCents)} paid to it, waiting on this check` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <ConfirmButton
                      label="Not a real supplier"
                      tone="danger"
                      title="Reject this supplier?"
                      body="It can't be paid through Proven any more, and payments already made to it stop counting as proof."
                      confirmLabel="Reject supplier"
                      pendingLabel="Rejecting..."
                      cancelLabel="Not now"
                      action={rejectSupplierAction.bind(null, s.id)}
                    />
                    <ConfirmButton
                      label="Verify supplier"
                      title="Verify this supplier?"
                      body="You found this business yourself and it is a real, independent supplier. Payments to it then count as proof without review."
                      confirmLabel="Verify"
                      pendingLabel="Verifying..."
                      cancelLabel="Not now"
                      action={verifySupplierAction.bind(null, s.id)}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {failed.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "80ms" }}>
            <h2 className="font-serif text-lg text-ink">Didn&apos;t finish on PayPal</h2>
            <p className="mt-1 text-xs text-ink-muted">Retrying checks PayPal&apos;s own record first - shares PayPal already paid are recorded, never charged again.</p>
            <ul className="mt-3 space-y-3">
              {failed.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-held/30 bg-held-bg px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-held-text">{r.needTitle}</span>
                    <span className="block text-xs text-held-text/80">
                      {r.charityName} - {r.kind === "advance" ? "booking payment" : "delivery release"} of {formatUsd(r.amountCents)}
                      {r.status !== "failed" ? " - stopped while sending to PayPal" : ""}
                    </span>
                  </span>
                  <ConfirmButton
                    label="Retry"
                    title="Retry this release?"
                    body="Parts PayPal already paid are skipped - the same request IDs are reused, so nobody is charged twice."
                    confirmLabel="Retry now"
                    pendingLabel="Retrying..."
                    cancelLabel="Not now"
                    action={retryAction.bind(null, r.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {queue.closing.length > 0 && (
          <section className="rise-in mt-8" style={{ animationDelay: "100ms" }}>
            <h2 className="font-serif text-lg text-ink">Closed, but holds not yet cancelled</h2>
            <p className="mt-1 text-xs text-ink-muted">PayPal didn&apos;t confirm these cancels. Donors aren&apos;t charged either way - an unused hold lapses on its own.</p>
            <ul className="mt-3 space-y-3">
              {queue.closing.map((c) => (
                <li key={c.needId} className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line bg-card px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{c.needTitle}</span>
                    <span className="block text-xs text-ink-muted">
                      {c.charityName} - {formatUsd(c.heldCents)} still held on {c.holds} {c.holds === 1 ? "hold" : "holds"}
                    </span>
                  </span>
                  <ConfirmButton
                    label="Cancel holds again"
                    title="Try cancelling these holds again?"
                    body="PayPal's record is checked first, then every remaining hold is cancelled and donors are emailed."
                    confirmLabel="Cancel holds"
                    pendingLabel="Cancelling holds..."
                    cancelLabel="Not now"
                    action={finishClosingAction.bind(null, c.needId)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {waiting.length === 0 ? (
          <p className="mt-10 rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
            The queue is clear. New requests show up here as charities make them.
          </p>
        ) : (
          <ul className="mt-8 space-y-4">
            {waiting.map((r, i) => (
              <li key={r.id} className="rise-in rounded-[10px] border border-line bg-card p-5" style={{ animationDelay: `${120 + i * 60}ms` }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <StatusPill tone="review">{r.reviewReason ?? "Needs review"}</StatusPill>
                    <h3 className="mt-2 font-serif text-xl text-ink">
                      <Link href={`/needs/${r.needId}`} className="hover:underline hover:underline-offset-4">{r.needTitle}</Link>
                    </h3>
                    <p className="text-sm text-ink-muted">
                      {r.charityName} - {r.trustTier} charity - asked {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-ink-muted">{r.kind === "advance" ? "Booking payment" : "Delivery release"}</p>
                    <Money cents={r.amountCents} className="text-2xl text-ink" />
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-mono text-xs [&>dd]:text-right [&>dt]:text-ink-muted">
                  <dt>Need</dt>
                  <dd><Money cents={r.needAmountCents} /></dd>
                  <dt>Held now</dt>
                  <dd><Money cents={r.heldCents} /></dd>
                  <dt>{r.kind === "advance" ? "Stays held" : "Never charged"}</dt>
                  <dd className="text-proven">{formatUsd(Math.max(0, r.heldCents - r.amountCents))}</dd>
                  <dt>Deliver by</dt>
                  <dd>{formatDate(r.deadline)}</dd>
                  <dt>Proof required</dt>
                  <dd>{r.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(" + ")}</dd>
                </dl>
                {r.note && <p className="mt-3 rounded-md bg-[#efece4] px-3 py-2 text-sm text-ink-soft">&ldquo;{r.note}&rdquo;</p>}

                <div className="mt-4">
                  <p className="text-xs text-ink-muted">Proof on this need</p>
                  {(proofsByNeed.get(r.needId) ?? []).length === 0 ? (
                    <p className="mt-1 text-sm text-ink-soft">No proof uploaded yet.</p>
                  ) : (
                    <div className="mt-2">
                      <ProofList proofs={proofsByNeed.get(r.needId)!} />
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  {r.kind === "final" && (
                    <ConfirmButton
                      label="Not proven"
                      tone="danger"
                      align="left"
                      title="Mark this need not proven?"
                      body={`Every hold on it is cancelled - ${formatUsd(r.heldCents)} is never charged. Donors get an email.`}
                      confirmLabel="Mark not proven"
                    pendingLabel="Releasing holds..."
                      action={notProvenAction.bind(null, r.needId)}
                      className="mr-auto"
                    />
                  )}
                  <ConfirmButton
                    label="Send back"
                    tone="danger"
                    title="Send this release back?"
                    body="Nothing is charged. The need reopens so the charity can send a corrected request."
                    confirmLabel="Send back"
                    pendingLabel="Sending back..."
                    action={rejectAction.bind(null, r.id)}
                  />
                  <ConfirmButton
                    label={`Approve ${formatUsd(r.amountCents)}`}
                    title="Approve and pay?"
                    body={
                      r.kind === "final"
                        ? `PayPal pays ${r.charityName} ${formatUsd(r.amountCents)} from donors' holds, in proportion. The rest of every hold is cancelled.`
                        : `PayPal pays ${r.charityName} ${formatUsd(r.amountCents)} now. The rest stays held until delivery.`
                    }
                    confirmLabel="Approve and pay"
                    pendingLabel="Paying..."
                    cancelLabel="Not yet"
                    action={approveAction.bind(null, r.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {refundable.length > 0 && (
          <section className="mt-12">
            <h2 className="font-serif text-lg text-ink">Charged needs</h2>
            <p className="mt-1 text-xs text-ink-muted">If a delivery turns out to be false, refund the donors from here.</p>
            <ul className="mt-3 divide-y divide-dashed divide-line rounded-[10px] border border-line bg-card">
              {refundable.map((n) => (
                <li key={n.needId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{n.needTitle}</span>
                    <span className="block text-xs text-ink-muted">
                      {n.charityName} - charged {formatUsd(n.chargedCents)}
                      {n.refundedCents > 0 ? `, refunded ${formatUsd(n.refundedCents)}` : ""}
                    </span>
                  </span>
                  <Link
                    href={`/review/needs/${n.needId}`}
                    className="rounded-full border border-line px-3 py-1 text-xs text-ink transition-colors hover:border-ink-muted"
                  >
                    Refund
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {verified.length > 0 && (
          <section className="mt-12">
            <h2 className="font-serif text-lg text-ink">Verified suppliers</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-muted">
              If a supplier turns out not to be independent - it works with a charity, or isn&apos;t a real business - revoke it. Proof resting on it fails, and needs already released on it show above.
            </p>
            <ul className="mt-3 divide-y divide-dashed divide-line rounded-[10px] border border-line bg-card">
              {verified.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-muted">
                      PayPal name: {s.paypalName ?? "not known yet"}
                      {s.country ? ` (${s.country})` : ""} - verified {formatDate(s.verifiedAt)} - {formatUsd(s.paidCents)} paid through Proven
                    </span>
                  </span>
                  <ConfirmButton
                    label="Revoke"
                    tone="danger"
                    title="Revoke this supplier?"
                    body="It can't be paid through Proven any more. Every payment and confirmation from it stops counting as proof, and needs already released on it are flagged for refund."
                    confirmLabel="Revoke supplier"
                    pendingLabel="Revoking..."
                    cancelLabel="Not now"
                    action={revokeSupplierAction.bind(null, s.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
