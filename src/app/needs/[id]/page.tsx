import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink, Money, NeedStatus, SiteHeader, formatDate } from "@/components/ui";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { getPublicNeed } from "@/server/needs/repo";
import { formatUsd } from "@/server/money";
import { DonateForm } from "./donate-form";
import { demoLoginEnabled } from "@/server/auth/demo-login";
import { DEMO_DONOR_LOGIN } from "@/server/demo/judge-login";
import { startDonationAction } from "./actions";
import { OtherNeeds } from "@/components/other-needs";
import { MIN_DONATION_CENTS, remainingForNeed, reservedForNeed } from "@/server/donations/service";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { ProgressBar } from "@/components/motion/progress-bar";
import { PriceCheck } from "@/components/price-check";
import { getPriceCheck } from "@/server/prices/check";
import { MIN_COMPARABLES_FOR_DONORS } from "@/server/prices/price-rules";

export const dynamic = "force-dynamic";

/** What a shared link to this need says: the need itself, who asks, how much and by when. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const need = await getPublicNeed((await params).id);
  if (!need) return { title: "Need not found", robots: { index: false, follow: false } };
  const by = need.deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const description = `${need.charityName} needs ${formatUsd(need.amountCents).replace(/\.00$/, "")} by ${by}. Give with PayPal - you're only charged when delivery is proven.`;
  return {
    title: need.title,
    description,
    openGraph: { type: "article", title: need.title, description },
    twitter: { card: "summary_large_image", title: need.title, description },
  };
}

export default async function NeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const [{ id }, { cancelled }] = await Promise.all([params, searchParams]);
  const need = await getPublicNeed(id);
  if (!need) notFound();

  const pct = Math.min(100, Math.round((need.heldCents / need.amountCents) * 100));
  // Includes gifts waiting on PayPal approval, so two donors can't both take the last dollars.
  // Gifts started but not yet approved on PayPal (they hold their place for 15 minutes) - counted directly.
  const [remaining, reserved, price] = await Promise.all([remainingForNeed(need.id), reservedForNeed(need.id), getPriceCheck(need.id)]);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <article className="rise-in">
          <BackLink href="/needs">Back to all needs</BackLink>
          <p className="mt-4 text-sm text-ink-muted">{need.charityName}</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight text-ink sm:text-4xl">{need.title}</h1>
          <div className="mt-3">
            <NeedStatus status={need.status} />
          </div>
          <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-ink-soft">{need.description}</p>

          <h2 className="mt-10 font-serif text-xl text-ink">How your money is protected</h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>1. When you give, PayPal holds your money. Nothing is taken yet.</li>
            <li>
              2. The charity has until {formatDate(need.deadline)} to deliver and prove it with:{" "}
              {need.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(", ")}.
            </li>
            <li>3. Once it&apos;s proven, you pay only your share of what was actually spent.</li>
            <li>4. If it isn&apos;t proven in time, your money goes back to you. You pay nothing.</li>
          </ol>
          {/* Donors see the check only when it reassures: anything else is for the charity and reviewers. */}
          {price && price.status === "checked" && price.verdict === "in_line" && price.comparableCount >= MIN_COMPARABLES_FOR_DONORS && (
            <div className="mt-6">
              <PriceCheck check={price} />
            </div>
          )}
        </article>

        <aside className="rise-in self-start rounded-[10px] border border-line bg-card p-6" style={{ animationDelay: "120ms" }}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-sm [&>dt]:whitespace-nowrap [&>dd]:text-right">
            <dt className="text-ink-muted">Needed</dt>
            <dd className="text-right"><Money cents={need.amountCents} /></dd>
            <dt className="text-ink-muted">Held so far</dt>
            <dd className="text-right"><AnimatedMoney cents={need.heldCents} delay={0.2} /></dd>
            {reserved > 0 && (
              <>
                <dt className="text-ink-muted">Being approved on PayPal</dt>
                <dd className="text-right"><Money cents={reserved} /></dd>
              </>
            )}
            <dt className="text-ink-muted">Donors</dt>
            <dd className="text-right">{need.donorCount}</dd>
            <dt className="text-ink-muted">Deliver by</dt>
            <dd className="text-right">{formatDate(need.deadline)}</dd>
            <dt className="text-ink-muted">Charity gets paid</dt>
            <dd className="text-right">{need.fundingModel === "staged" ? "Part paid when booked, rest after delivery" : "After delivery"}</dd>
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
            <DonateForm action={startDonationAction.bind(null, need.id)} remainingCents={remaining} remainingLabel={formatUsd(remaining)} testLogin={demoLoginEnabled() ? DEMO_DONOR_LOGIN : undefined} />
          ) : need.status === "open" ? (
            <div className="rise-in mt-5">
              <p className="font-serif text-lg text-ink">This need is covered</p>
              <p className="mt-1 text-sm text-ink-muted">Every dollar is already given. Thank you - these still need help:</p>
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
