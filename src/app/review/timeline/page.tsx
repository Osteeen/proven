import type { Metadata } from "next";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { HoldsBoard } from "@/components/timeline/holds-board";
import { BackLink, DemoBanner, ReviewerHeader } from "@/components/ui";
import { requireReviewer } from "@/server/auth/access";
import { reviewerCharityScope } from "@/server/auth/scope";
import { timelineData } from "@/server/releases/timeline";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Timeline - Proven", robots: { index: false, follow: false } };

// Read once per request on the server.
const requestTime = () => new Date().toISOString();

/** Every live need against its holds' 29-day life, for reviewers (scoped like the queue). */
export default async function TimelinePage() {
  const reviewer = await requireReviewer();
  const data = await timelineData(await reviewerCharityScope(reviewer));
  return (
    <>
      <ReviewerHeader signOut={<SignOutButton />} current="timeline" />
      {reviewer.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <BackLink href="/review">Back to review queue</BackLink>
        <div className="rise-in mt-3">
          <h1 className="font-serif text-3xl text-ink">Holds timeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            A PayPal hold lasts 29 days. Each need&apos;s delivery deadline has to land before its holds lapse - this shows which needs are running out of time. Search or filter the holds list to narrow the timeline.
          </p>
        </div>
        <div className="mt-6">
          <HoldsBoard needs={data.needs} holds={data.holds} now={requestTime()} />
        </div>
      </main>
    </>
  );
}
