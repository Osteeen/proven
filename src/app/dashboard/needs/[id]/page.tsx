import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { ConfirmButton } from "@/components/motion/confirm-button";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { BackLink, CharityHeader, DemoBanner, Money, NeedStatus, StatusPill, formatDate } from "@/components/ui";
import { requireCharity } from "@/server/auth/access";
import { formatUsd } from "@/server/money";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { ProofList } from "@/components/proof-list";
import { listProofsForCharity } from "@/server/proofs/service";
import { recipientCheckSummary } from "@/server/proofs/recipients";
import { getNeedForCharity } from "@/server/releases/queries";
import { finalReleaseRoomCents, proofChecked as isProofChecked } from "@/server/releases/rules";
import { getReleaseProof } from "@/server/releases/service";
import { PriceCheck } from "@/components/price-check";
import { getPriceCheck } from "@/server/prices/check";
import { confirmationStatusByPayment } from "@/server/suppliers/confirmations";
import { listSupplierPayments, listSuppliersForCharity } from "@/server/suppliers/service";
import { cancelNeedAction } from "./actions";
import { ReceiptUpload } from "./receipt-upload";
import { RecipientCheckForm } from "./recipient-check";
import { ReleaseForm } from "./release-form";
import { CheckPaymentButton, SupplierPay } from "./supplier-pay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage need" };

const RELEASE_STATUS: Record<string, { tone: "held" | "proven" | "void" | "review" | "neutral"; label: string }> = {
  pending_review: { tone: "review", label: "Waiting for review" },
  approved: { tone: "review", label: "Approved - sending to PayPal" },
  executing: { tone: "review", label: "Sending to PayPal" },
  completed: { tone: "proven", label: "Paid" },
  failed: { tone: "held", label: "PayPal didn't finish - retry pending" },
  rejected: { tone: "void", label: "Not approved" },
};

const PAID_NOTICE: Record<string, { tone: string; text: string }> = {
  completed: { tone: "border-proven/30 bg-proven-bg text-proven-text", text: "You paid the supplier with PayPal. PayPal's record of the payment is now proof on this need." },
  processing: { tone: "border-review/30 bg-review-bg text-review-text", text: "PayPal is still finishing the payment. Use Check PayPal below in a minute." },
  not_approved: { tone: "border-line bg-card text-ink-muted", text: "The payment wasn't approved on PayPal, so nothing was paid." },
  cancelled: { tone: "border-line bg-card text-ink-muted", text: "Payment cancelled on PayPal. Nothing was paid." },
  failed: { tone: "border-[#f09595] bg-[#fcebeb] text-[#791f1f]", text: "The payment didn't go through, so nothing was paid. The reason is below." },
};

const RELEASED_NOTICE: Record<string, { tone: string; text: string }> = {
  completed: { tone: "border-proven/30 bg-proven-bg text-proven-text", text: "Paid. PayPal has sent it to your account - the details are below." },
  pending_review: { tone: "border-review/30 bg-review-bg text-review-text", text: "Sent to a reviewer. They check it before PayPal pays you. Donors aren't charged until then." },
  failed: { tone: "border-[#f09595] bg-[#fcebeb] text-[#791f1f]", text: "PayPal didn't finish this payment. Nobody was charged extra - a reviewer can try again." },
};

const PAYMENT_STATUS: Record<string, { tone: "held" | "proven" | "void" | "review" | "neutral"; label: string }> = {
  created: { tone: "review", label: "Not finished" },
  completed: { tone: "proven", label: "Paid" },
  failed: { tone: "void", label: "Didn't go through" },
  refunded: { tone: "held", label: "Refunded by supplier" },
};

const CONFIRMATION: Record<string, string> = {
  requested: "Supplier asked to confirm the handover - waiting",
  confirmed: "Supplier confirmed the handover",
  denied: "Supplier said this order isn't right - a reviewer checks it",
  none: "The supplier is asked to confirm once Proven has verified it",
};

const HOLD_STATUS: Record<string, string> = {
  authorized: "Held",
  partially_captured: "Partly charged",
  captured: "Charged",
  voided: "Released",
  expired: "Lapsed",
};

export default async function ManageNeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string; released?: string }> }) {
  const ctx = await requireCharity();
  const { id } = await params;
  const { paid, released } = await searchParams;
  const releasedNotice = typeof released === "string" ? RELEASED_NOTICE[released] : undefined;
  const paidNotice = typeof paid === "string" ? PAID_NOTICE[paid] : undefined;
  // Ownership is in the query: another charity's need is simply not found.
  const n = await getNeedForCharity(ctx, id);
  if (!n) notFound();

  const open = n.status === "open";
  const closable = ["open", "in_review", "funded", "delivering"].includes(n.status);
  const liveDonors = n.liveDonors;
  const [proofs, suppliers, payments, confirmations, recipients] = await Promise.all([
    listProofsForCharity(ctx, n.id),
    listSuppliersForCharity(ctx),
    listSupplierPayments(ctx, n.id),
    confirmationStatusByPayment(ctx.charityId, n.id),
    recipientCheckSummary(ctx, n.id),
  ]);
  const releaseProof = (await getReleaseProof(ctx, n.id))!;
  const price = await getPriceCheck(n.id);
  const receiptSpend = proofs.filter((p) => p.kind === "receipt" && p.status === "passed").reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const supplierPaid = payments.filter((p) => p.status === "completed").reduce((s, p) => s + p.amountCents, 0);
  const acceptsProof = ["open", "in_review"].includes(n.status);
  const canPaySupplier = ["open", "funded", "delivering", "in_review"].includes(n.status);
  // The final-release rule, read by the same function the release itself is checked with.
  const passed = proofs.filter((p) => p.status === "passed");
  const proofOk = isProofChecked(releaseProof);
  const roomCents = finalReleaseRoomCents(releaseProof);
  const promised = releaseProof.requiredSecondChecks;
  const secondCheck = passed.find((p) => promised.includes(p.kind));
  const promisedLeft = promised.filter((k) => !releaseProof.passedKinds.includes(k));
  // The release can be asked for once the supplier is paid and one promised check passed;
  // it skips review only when everything promised passed and nothing is in doubt (proofOk).
  const gateOpen = releaseProof.supplierPaidCents > 0 && Boolean(secondCheck);
  const canRelease = open && n.heldCents > 0 && !n.inFlight;
  const showBooking = canRelease && n.fundingModel === "staged" && n.advanceLeftCents > 0;
  const releaseProps = {
    needId: n.id,
    heldCents: n.heldCents,
    advanceLeftCents: n.advanceLeftCents,
    finalRoomCents: releaseProof.requiresSupplierPayment ? roomCents : null,
    proofChecked: proofOk,
    requiresSupplierPayment: releaseProof.requiresSupplierPayment,
    priceWellAboveMarket: price?.verdict === "well_above",
    donorCount: liveDonors,
    trustTier: n.trustTier,
    completedReleases: n.completedReleases,
    thresholdCents: n.thresholdCents,
  };

  return (
    <>
      <CharityHeader signOut={<SignOutButton />} />
      {ctx.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <BackLink href="/dashboard">Back to dashboard</BackLink>
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

        {price && price.status === "checked" && (
          <div className="rise-in mt-6">
            <PriceCheck check={price} detailed />
          </div>
        )}
        {releasedNotice && (
          <p role="status" className={`rise-in mt-6 rounded-[10px] border px-4 py-3 text-sm ${releasedNotice.tone}`}>
            {releasedNotice.text}
          </p>
        )}
        {paidNotice && (
          <p role="status" className={`rise-in mt-6 rounded-[10px] border px-4 py-3 text-sm ${paidNotice.tone}`}>
            {paidNotice.text}
          </p>
        )}

        <dl className="mt-7 grid grid-cols-3 gap-3">
          {[
            { label: "Held by PayPal", cents: n.heldCents, accent: "text-held" },
            { label: "Paid to you", cents: n.chargedCents - n.refundedCents, accent: "text-proven" },
            { label: "Returned to donors", cents: n.releasedCents, accent: "text-ink-muted" },
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

        {n.inFlight && (
          <p className="mt-8 rounded-[10px] border border-review/30 bg-review-bg px-4 py-3 text-sm text-review-text" role="status">
            {n.inFlight.status === "pending_review"
              ? `Your request for ${formatUsd(n.inFlight.amountCents)} is waiting for a reviewer. Donors aren't charged until it's approved.`
              : n.inFlight.status === "failed"
                ? `Your request for ${formatUsd(n.inFlight.amountCents)} didn't finish on PayPal. A reviewer will try again - nobody is charged twice.`
                : `PayPal is paying your request for ${formatUsd(n.inFlight.amountCents)} now.`}
          </p>
        )}

        {showBooking && (
          <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "180ms" }}>
            <h2 className="font-serif text-xl text-ink">Get money to book the goods</h2>
            <p className="mb-5 mt-1 text-sm text-ink-muted">
              Take up to {formatUsd(n.advanceLeftCents)} now to book the supplier. The rest is released after delivery.
            </p>
            <ReleaseForm kind="advance" {...releaseProps} />
          </section>
        )}

        {(canPaySupplier || payments.length > 0) && (
          <section className="rise-in mt-8" style={{ animationDelay: "200ms" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-lg text-ink">Pay your supplier with PayPal</h2>
              {supplierPaid > 0 && (
                <p className="font-mono text-xs text-proven-text">
                  Paid to suppliers: <Money cents={supplierPaid} />
                </p>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Buy the goods through Proven and PayPal itself records who was paid, how much and when - the strongest proof a delivery was bought.
            </p>
            {canPaySupplier && (
              <div className="mt-3">
                <SupplierPay needId={n.id} suppliers={suppliers} remainingCents={Math.max(0, n.amountCents - supplierPaid)} canPay={n.amountCents - supplierPaid > 0} />
              </div>
            )}
            {payments.length > 0 && (
              <ul className="mt-4 divide-y divide-dashed divide-line rounded-[10px] border border-line bg-card">
                {payments.map((p) => {
                  const s = PAYMENT_STATUS[p.status] ?? { tone: "neutral" as const, label: p.status };
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="text-ink">{p.supplierName}</span>
                        <span className="ml-2 text-xs text-ink-muted">{formatDate(p.createdAt)}</span>
                        <span className="block truncate text-xs text-ink-muted">{p.description}</span>
                        {(p.status === "failed" || p.status === "refunded") && p.failure && <span className="block text-xs text-[#791f1f]">{p.failure}</span>}
                        {p.status === "completed" && <span className="block text-xs text-ink-muted">{CONFIRMATION[confirmations.get(p.id) ?? "none"]}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <Money cents={p.amountCents} />
                        {p.status === "created" ? (
                          <CheckPaymentButton needId={n.id} paymentId={p.id} />
                        ) : p.disputedAt && p.status === "completed" ? (
                          <StatusPill tone="held">Disputed on PayPal</StatusPill>
                        ) : (
                          <StatusPill tone={s.tone}>{s.label}</StatusPill>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {(acceptsProof || proofs.length > 0) && (
          <section className="rise-in mt-8" style={{ animationDelay: "210ms" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-lg text-ink">Proof of delivery</h2>
              {receiptSpend > 0 && (
                <p className="font-mono text-xs text-proven-text">
                  Spend checked from receipts: <Money cents={receiptSpend} />
                </p>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              This need is released when {n.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(" and ").toLowerCase()} check out.
            </p>
            {acceptsProof && n.requiredProof.includes("receipt") && (
              <div className="mt-3">
                <ReceiptUpload needId={n.id} />
              </div>
            )}
            {n.requiredProof.includes("recipient_confirmation") &&
              (recipients ? (
                <p className="mt-3 rounded-[10px] border border-line bg-card px-4 py-3 text-sm text-ink-soft">
                  Recipient check sent: Proven texted {recipients.sample} of the {recipients.total.toLocaleString("en-US")} people you recorded, picked at random. {recipients.yes} said yes,{" "}
                  {recipients.no} said no, {recipients.sample - recipients.yes - recipients.no} yet to answer.
                </p>
              ) : !acceptsProof ? null : releaseProof.requiresSupplierPayment && !payments.some((p) => p.status === "completed") ? (
                <p className="mt-3 rounded-[10px] border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
                  Recipient check: once you&apos;ve paid the supplier and handed out the goods, enter the phone numbers you recorded here. Proven texts a random few.
                </p>
              ) : (
                <div className="mt-3">
                  <RecipientCheckForm needId={n.id} />
                </div>
              ))}
            {proofs.length > 0 && (
              <div className="mt-4">
                <ProofList proofs={proofs} />
              </div>
            )}
          </section>
        )}

        {open && (
          <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "230ms" }}>
            <h2 className="font-serif text-xl text-ink">Get paid</h2>
            <p className="mt-1 text-sm text-ink-muted">PayPal pays you straight from donors&apos; held money. Donors only pay what you ask for - the rest goes back to them.</p>
            {releaseProof.requiresSupplierPayment && (
              <ul className="mt-4 space-y-2 text-sm">
                <Check done={releaseProof.supplierPaidCents > 0}>
                  {releaseProof.supplierPaidCents > 0 ? (
                    <>
                      Paid the supplier with PayPal - <Money cents={releaseProof.supplierPaidCents} />
                    </>
                  ) : (
                    "Pay the supplier with PayPal (above)"
                  )}
                </Check>
                <Check done={Boolean(secondCheck)}>
                  {secondCheck
                    ? `One more check passed - ${(PROOF_LABELS[secondCheck.kind as ProofType] ?? secondCheck.kind).toLowerCase()}`
                    : `One more check that passes - ${promised.map((k) => (PROOF_LABELS[k as ProofType] ?? k).toLowerCase()).join(" or ")} (above)`}
                </Check>
              </ul>
            )}
            {gateOpen && !proofOk && (
              <p className="mt-3 rounded-md border border-review/30 bg-review-bg px-3 py-2 text-xs text-review-text">
                {releaseProof.openIssues > 0
                  ? "Some proof didn't pass or is waiting for a person, so a Proven reviewer checks this before donors are charged."
                  : promisedLeft.length === 0
                    ? "The supplier's word alone isn't enough, so a Proven reviewer checks this first."
                  : `Some checks you promised haven't passed yet (${promisedLeft.map((k) => (PROOF_LABELS[k as ProofType] ?? k).toLowerCase()).join(", ")}), so a Proven reviewer checks this first.`}
              </p>
            )}
            <div className="mt-5">
              {n.inFlight ? (
                <p className="text-sm text-ink-muted">A payment request is already in progress - see above.</p>
              ) : n.heldCents === 0 ? (
                <p className="text-sm text-ink-muted">No donations yet. Share the public page - you can ask to be paid once donors give.</p>
              ) : releaseProof.requiresSupplierPayment && !gateOpen ? (
                <p className="text-sm text-ink-muted">You can ask to be paid once both checks above pass.</p>
              ) : releaseProof.requiresSupplierPayment && roomCents === 0 ? (
                <p className="text-sm text-ink-muted">You&apos;ve been paid back everything you paid suppliers. Pay a supplier again to ask for more.</p>
              ) : (
                <ReleaseForm kind="final" {...releaseProps} />
              )}
            </div>
          </section>
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
                      <span className="text-ink">{r.kind === "advance" ? "Booking payment" : "Delivery payment"}</span>
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
                  {n.heldCents > 0 ? `${formatUsd(n.heldCents)} held for ${liveDonors} ${liveDonors === 1 ? "donor" : "donors"} goes back to them. Nobody is charged.` : "Nothing is held right now."}
                  {n.chargedCents - n.refundedCents > 0 ? ` The ${formatUsd(n.chargedCents - n.refundedCents)} already paid for the booking stays paid.` : ""} Donors get an email. This can&apos;t be undone.
                </>
              }
              confirmLabel="Close and return donations"
              pendingLabel="Closing..."
              action={cancelNeedAction.bind(null, n.id)}
            />
          </section>
        )}
      </main>
    </>
  );
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${done ? "border-proven bg-proven text-paper" : "border-line bg-card"}`}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
      <span className={done ? "text-ink" : "text-ink-muted"}>
        <span className="sr-only">{done ? "Done: " : "Not yet: "}</span>
        {children}
      </span>
    </li>
  );
}
