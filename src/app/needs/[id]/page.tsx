import { notFound } from "next/navigation";
import { Money, NeedStatus, SiteHeader, formatDate } from "@/components/ui";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { getPublicNeed } from "@/server/needs/repo";
import { formatUsd } from "@/server/money";
import { DonateForm } from "./donate-form";
import { startDonationAction } from "./actions";
import { OtherNeeds } from "@/components/other-needs";
import { MIN_DONATION_CENTS, remainingForNeed, reservedForNeed } from "@/server/donations/service";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { ProgressBar } from "@/components/motion/progress-bar";

export const dynamic = "force-dynamic";

export default async function NeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const [{ id }, { cancelled }] = await Promise.all([params, searchParams]);
  const need = await getPublicNeed(id);
  if (!need) notFound();

  const pct = Math.min(100, Math.round((need.heldCents / need.amountCents) * 100));
  // Includes gifts waiting on PayPal approval, so two donors can't both take the last dollars.
  // Gifts started but not yet approved on PayPal (they hold their place for 15 minutes) - counted directly.
  const [remaining, reserved] = await Promise.all([remainingForNeed(need.id), reservedForNeed(need.id)]);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <article className="rise-in">
          <p className="text-sm text-ink-muted">{need.charityName}</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight text-ink sm:text-4xl">{need.title}</h1>
          <div className="mt-3">
            <NeedStatus status={need.status} />
          </div>
          <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-ink-soft">{need.description}</p>

          <h2 className="mt-10 font-serif text-xl text-ink">How your money is protected</h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>1. When you give, PayPal holds the amount on your account. You are not charged.</li>
            <li>
              2. The charity has until {formatDate(need.deadline)} to deliver and prove it with:{" "}
              {need.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(", ")}.
            </li>
            <li>3. If at least two checks agree, you&apos;re charged only what was actually spent.</li>
            <li>4. If it isn&apos;t proven in time, the hold is cancelled and you&apos;re never charged.</li>
          </ol>
        </article>

        <aside className="rise-in self-start rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "120ms" }}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-sm [&>dt]:whitespace-nowrap [&>dd]:text-right">
            <dt className="text-ink-muted">Needed</dt>
            <dd className="text-right"><Money cents={need.amountCents} /></dd>
            <dt className="text-ink-muted">Held so far</dt>
            <dd className="text-right"><AnimatedMoney cents={need.heldCents} delay={0.2} /></dd>
            {reserved > 0 && (
              <>
                <dt className="text-ink-muted">Waiting on PayPal</dt>
                <dd className="text-right"><Money cents={reserved} /></dd>
              </>
            )}
            <dt className="text-ink-muted">Donors</dt>
            <dd className="text-right">{need.donorCount}</dd>
            <dt className="text-ink-muted">Deliver by</dt>
            <dd className="text-right">{formatDate(need.deadline)}</dd>
            <dt className="text-ink-muted">Release</dt>
            <dd className="text-right">{need.fundingModel === "staged" ? "Part on booking, rest on delivery" : "After delivery"}</dd>
          </dl>
          <div className="mt-5">
            <ProgressBar pct={pct} className="h-1.5" delay={0.3} />
          </div>
          {cancelled && (
            <p role="status" className="rise-in mt-5 rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
              You cancelled on PayPal. Nothing was held or charged.
            </p>
          )}
          {need.status === "open" && remaining >= MIN_DONATION_CENTS ? (
            <DonateForm action={startDonationAction.bind(null, need.id)} remainingCents={remaining} remainingLabel={formatUsd(remaining)} />
          ) : need.status === "open" ? (
            <div className="rise-in mt-5">
              <p className="font-serif text-lg text-ink">This need is covered</p>
              <p className="mt-1 text-sm text-ink-muted">Every dollar is held or waiting on PayPal. Thank you - these still need help:</p>
              <OtherNeeds excludeId={need.id} title="" />
            </div>
          ) : (
            <p className="mt-5 text-sm text-ink-muted">This need isn&apos;t taking new donations.</p>
          )}
        </aside>
      </main>
    </>
  );
}
