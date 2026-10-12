import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { CopyLinkButton } from "@/components/motion/copy-link";
import { GiftSteps } from "@/components/motion/gift-steps";
import { OtherNeeds } from "@/components/other-needs";
import { Money, SiteHeader, StatusPill, formatDate } from "@/components/ui";
import { getGiftForDonor } from "@/server/donations/service";
import { maskEmail } from "@/server/mail/mailer";
import { formatUsd } from "@/server/money";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { startTopUpAction } from "../../needs/[id]/actions";
import { DonateForm } from "../../needs/[id]/donate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your gift - Proven", robots: { index: false, follow: false } };

type Stage = 0 | 1 | 2;
const VIEW: Record<string, { headline: string; tone: "held" | "proven" | "void" | "review" | "neutral"; pill: string; stage: Stage; outcome: "proven" | "void" | "open" }> = {
  pending_approval: { headline: "Waiting for PayPal", tone: "neutral", pill: "Not held yet", stage: 0, outcome: "open" },
  authorized: { headline: "Your gift is held - you haven't been charged", tone: "held", pill: "Held - not charged", stage: 0, outcome: "open" },
  advance: { headline: "Part of your gift paid the booking - the rest waits for delivery", tone: "held", pill: "Partly charged", stage: 0, outcome: "open" },
  in_review: { headline: "Delivery submitted - it's being checked", tone: "review", pill: "Being checked", stage: 1, outcome: "open" },
  proven: { headline: "Delivery proven - your gift did its job", tone: "proven", pill: "Proven - charged", stage: 2, outcome: "proven" },
  closing: { headline: "Closed - your hold is being released", tone: "void", pill: "Releasing", stage: 1, outcome: "open" },
  voided: { headline: "Not proven - you were never charged", tone: "void", pill: "Never charged", stage: 2, outcome: "void" },
  closed_after_advance: { headline: "Closed - only the booking was charged", tone: "void", pill: "Closed", stage: 2, outcome: "void" },
  refunded: { headline: "Refunded - you got your money back", tone: "void", pill: "Refunded", stage: 2, outcome: "void" },
  failed: { headline: "No money was held", tone: "void", pill: "Not held", stage: 0, outcome: "open" },
};

const HOLD_LABEL: Record<string, string> = {
  authorized: "Held",
  partially_captured: "Partly charged",
  captured: "Charged",
  voided: "Released - never charged",
  expired: "Released - never charged",
};

export default async function DonorGiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ problem?: string; cancelled?: string }>;
}) {
  const [{ key }, { problem, cancelled }] = await Promise.all([params, searchParams]);
  const g = await getGiftForDonor(key);
  if (!g) notFound();
  const v = VIEW[g.status] ?? VIEW.pending_approval!;
  const live = g.status !== "failed" && g.status !== "pending_approval";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-8 sm:px-6">
        {problem === "declined" && (
          <p role="alert" className="rise-in mb-6 rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
            PayPal didn&apos;t approve that hold, so nothing new was held or charged.
          </p>
        )}
        {problem === "filled" && (
          <div role="alert" className="rise-in mb-6 rounded-md border border-line bg-card px-4 py-3 text-sm text-ink-soft">
            This need filled up while you were on PayPal, so nothing new was held. You haven&apos;t been charged for it.
          </div>
        )}
        {cancelled && (
          <p role="status" className="rise-in mb-6 rounded-md border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
            You cancelled on PayPal. Nothing new was held.
          </p>
        )}

        <div className="rise-in">
          <StatusPill tone={v.tone}>{v.pill}</StatusPill>
          <h1 className="mt-3 font-serif text-3xl leading-tight text-ink sm:text-4xl">{v.headline}</h1>
          <p className="mt-2 text-ink-soft">
            For <Link href={`/needs/${g.needId}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">{g.needTitle}</Link> - {g.charityName}
          </p>
        </div>

        {live && <GiftSteps stage={v.stage} outcome={v.outcome} />}

        <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "200ms" }}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 font-mono text-sm [&>dd]:text-right [&>dt]:whitespace-nowrap [&>dt]:text-ink-muted">
            <dt>Your gift</dt>
            <dd><AnimatedMoney cents={g.giftCents} delay={0.3} /></dd>
            <dt>{v.outcome === "open" ? "Charged so far" : "Charged"}</dt>
            <dd><AnimatedMoney cents={g.chargedCents} delay={0.45} /></dd>
            {g.refundedCents > 0 && (
              <>
                <dt>Refunded to you</dt>
                <dd className="text-proven"><AnimatedMoney cents={g.refundedCents} delay={0.55} /></dd>
              </>
            )}
            {v.outcome !== "open" && (
              <>
                <dt>Never charged</dt>
                <dd className="text-proven"><AnimatedMoney cents={g.giftCents - g.chargedCents} delay={0.6} /></dd>
              </>
            )}
            {g.holdExpiresAt && g.heldCents > 0 && (
              <>
                <dt>Hold lasts until</dt>
                <dd>{formatDate(g.holdExpiresAt)}</dd>
              </>
            )}
            <dt>Deliver by</dt>
            <dd>{formatDate(g.deadline)}</dd>
            <dt>Released when</dt>
            <dd>{g.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(" + ")} check out</dd>
          </dl>

          {g.holds.length > 1 && (
            <ul className="mt-5 space-y-1.5 border-t border-dashed border-line pt-4 font-mono text-xs text-ink-soft">
              {g.holds.map((h, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>
                    {i === 0 ? "First gift" : "Added"} - {formatDate(h.at)}
                  </span>
                  <span>
                    <Money cents={h.amountCents} /> <span className="text-ink-muted">{HOLD_LABEL[h.status] ?? h.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {g.canTopUp && (
          <section className="rise-in mt-8 rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "280ms" }}>
            <p className="font-serif text-lg text-ink">Add to your gift</p>
            <p className="mt-1 text-sm text-ink-muted">It&apos;s held the same way and shows here as part of one gift.</p>
            <DonateForm
              action={startTopUpAction.bind(null, key, g.needId)}
              remainingCents={g.remainingCents}
              remainingLabel={formatUsd(g.remainingCents)}
              submitLabel="Add with PayPal"
              label="Add"
            />
          </section>
        )}

        {(problem === "filled" || (g.needStatus === "open" && g.remainingCents < 100)) && (
          <OtherNeeds excludeId={g.needId} title="These needs still have room:" />
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-line px-4 py-3">
          <CopyLinkButton path={`/d/${key}`} label="Copy your gift link" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">
            {g.emailedTo ? `We emailed this link to ${maskEmail(g.emailedTo)}. ` : ""}This page is your private link to this gift - save it to come back and see when it&apos;s proven. Anyone with the link can see its status, so share it only if you want to.
          </p>
        </div>
      </main>
    </>
  );
}
