import Link from "next/link";
import { CharityHeader, DemoBanner, PrimaryLink } from "@/components/ui";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { CopyLinkButton } from "@/components/motion/copy-link";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { Toast } from "@/components/motion/toast";
import { requireCharity } from "@/server/auth/access";
import { listCharityNeeds } from "@/server/needs/repo";
import { timelineData } from "@/server/releases/timeline";
import { NeedsTimeline } from "@/components/timeline/needs-timeline";
import { DashboardNeeds } from "./dashboard-needs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Read once per request on the server, so the "action needed" strip matches the data.
const requestTime = () => Date.now();

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ posted?: string }> }) {
  const charity = await requireCharity();
  const [needs, { posted }, timeline] = await Promise.all([listCharityNeeds(charity), searchParams, timelineData([charity.charityId])]);
  const held = needs.reduce((s, n) => s + n.heldCents, 0);
  const captured = needs.reduce((s, n) => s + n.capturedCents, 0);
  const open = needs.filter((n) => n.status === "open").length;
  // Only link a "posted" need that is really this charity's.
  const postedNeed = posted && UUID.test(posted) ? needs.find((n) => n.id === posted) : undefined;
  const now = requestTime();

  return (
    <>
      <CharityHeader signOut={<SignOutButton />} />
      {charity.isDemo && <DemoBanner note="Needs you post in the demo are cleared after 2 days; any holds on them are cancelled." />}
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <div className="rise-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-ink-muted">Charity dashboard</p>
            <h1 className="font-serif text-3xl text-ink">{charity.charityName}</h1>
          </div>
          <PrimaryLink href="/dashboard/needs/new">Post a need</PrimaryLink>
        </div>

        {postedNeed && (
          <Toast ms={12000}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>Need posted - it&apos;s live on Proven&apos;s public needs page.</span>
              <Link href={`/needs/${postedNeed.id}`} className="underline underline-offset-4">View public page</Link>
              <CopyLinkButton path={`/needs/${postedNeed.id}`} className="border-proven/30 bg-card/60" />
            </span>
          </Toast>
        )}

        <dl className="mt-8 grid grid-cols-3 gap-3">
          {[
            { label: "Held, not charged", value: <AnimatedMoney cents={held} delay={0.15} />, accent: "text-held" },
            { label: "Released to you", value: <AnimatedMoney cents={captured} delay={0.25} />, accent: "text-proven" },
            { label: "Open needs", value: <span className="font-mono">{open}</span>, accent: "text-ink" },
          ].map((m, i) => (
            <div key={m.label} className="rise-in rounded-[10px] bg-[#efece4] px-4 py-3" style={{ animationDelay: `${80 + i * 60}ms` }}>
              <dt className="text-xs text-ink-muted">{m.label}</dt>
              <dd className={`mt-1 text-xl ${m.accent}`}>{m.value}</dd>
            </div>
          ))}
        </dl>

        <DashboardNeeds
          now={now}
          needs={needs.map((n) => ({
            id: n.id,
            title: n.title,
            amountCents: n.amountCents,
            heldCents: n.heldCents,
            capturedCents: n.capturedCents,
            donorCount: n.donorCount,
            deadline: n.deadline.toISOString(),
            createdAt: n.createdAt.toISOString(),
            status: n.status,
          }))}
        />
        {timeline.needs.length > 0 && (
          <section className="mt-12">
            <h2 className="font-serif text-xl text-ink">Holds timeline</h2>
            <p className="mb-3 mt-1 text-sm text-ink-muted">Deliver and release before a hold lapses - PayPal holds last 29 days.</p>
            <NeedsTimeline needs={timeline.needs} holds={timeline.holds} now={new Date(now).toISOString()} />
          </section>
        )}
      </main>
    </>
  );
}
