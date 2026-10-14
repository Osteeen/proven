import type { Metadata } from "next";
import { ProvenMark } from "@/components/ui";
import { getRecipientQuestion } from "@/server/proofs/recipients";
import { recipientAnswerAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Did you receive help? - Proven", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The one-tap question texted to a randomly picked recipient. Kept short and
 * plain for a phone screen. Opening it never answers (link previews open links).
 */
export default async function RecipientCheckPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const { e } = await searchParams;
  const q = await getRecipientQuestion(token);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-8">
      <ProvenMark />
      <div className="mt-10 flex-1">
        {!q ? (
          <>
            <h1 className="font-serif text-3xl leading-tight text-ink">This link doesn&apos;t work</h1>
            <p className="mt-3 text-base text-ink-muted">It may have expired. Nothing else is needed from you.</p>
          </>
        ) : q.answered ? (
          <>
            <h1 className="font-serif text-3xl leading-tight text-ink">Thank you</h1>
            <p className="mt-3 text-base text-ink-muted">
              {q.answered === "yes" ? "Your answer helps the donors know their gift reached you." : "We'll look into it. Donors aren't charged for help that didn't arrive."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">For the donors to {q.charityName}</p>
            <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">Did you receive this?</h1>
            <p className="mt-3 rounded-[10px] bg-[#efece4] px-4 py-3 text-base text-ink">{q.needTitle}</p>
            {e && (
              <p role="alert" className="mt-4 rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
                That didn&apos;t go through. Wait a minute and tap again.
              </p>
            )}
            <form action={recipientAnswerAction.bind(null, token)} className="mt-6 grid gap-3">
              <button name="answer" value="yes" className="rounded-full bg-ink px-5 py-4 text-base text-paper transition-transform active:scale-[0.98]">
                Yes, I received it
              </button>
              <button name="answer" value="no" className="rounded-full border border-line bg-card px-5 py-4 text-base text-ink transition-transform active:scale-[0.98]">
                No, I didn&apos;t
              </button>
            </form>
            <p className="mt-5 text-xs text-ink-muted">Only your answer is recorded - not your name. You won&apos;t be asked again.</p>
          </>
        )}
      </div>
      <p className="text-xs text-ink-muted">PayPal sandbox demo - no real money moves.</p>
    </main>
  );
}
