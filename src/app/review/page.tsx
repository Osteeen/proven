import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmButton } from "@/components/motion/confirm-button";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { DemoBanner, ReviewerHeader, formatDate } from "@/components/ui";
import { requireReviewer } from "@/server/auth/access";
import { formatUsd } from "@/server/money";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { listProofsForNeed } from "@/server/proofs/service";
import { listRefundableNeeds, listReviewQueue, listWebhookAlerts } from "@/server/releases/queries";
import { listSuppliersToVerify, listVerifiedSuppliers, listWithdrawnProofNeeds } from "@/server/suppliers/service";
import { finishClosingAction, rejectSupplierAction, retryAction, revokeSupplierAction, verifySupplierAction } from "./actions";
import { QueueGrid } from "./queue-grid";
import { getPriceCheck } from "@/server/prices/check";

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
  const priceByNeed = new Map(await Promise.all([...new Set(waiting.map((r) => r.needId))].map(async (id) => [id, await getPriceCheck(id)] as const)));
  const failed = queue.releases.filter((r) => r.status !== "pending_review");

  return (
    <>
      <ReviewerHeader signOut={<SignOutButton />} current="queue" />
      {reviewer.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
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
          <section className="rise-in mt-8" style={{ animationDelay: "120ms" }}>
            <p className="mb-3 text-xs text-ink-muted">Open a row to see its proof and decide. Nothing is charged until you approve.</p>
            <QueueGrid
              rows={waiting.map((r) => ({
                id: r.id,
                needId: r.needId,
                needTitle: r.needTitle,
                charityName: r.charityName,
                trustTier: r.trustTier,
                kind: r.kind,
                amountCents: r.amountCents,
                needAmountCents: r.needAmountCents,
                heldCents: r.heldCents,
                deadline: r.deadline.toISOString(),
                createdAt: r.createdAt.toISOString(),
                reviewReason: r.reviewReason,
                note: r.note,
                requiredProof: r.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(" + "),
                proofs: proofsByNeed.get(r.needId) ?? [],
                price: (() => {
                  const c = priceByNeed.get(r.needId);
                  return c && c.status === "checked" ? c : null;
                })(),
              }))}
            />
          </section>
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
