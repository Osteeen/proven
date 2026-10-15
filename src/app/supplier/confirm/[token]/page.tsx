import type { Metadata } from "next";
import { SiteHeader, formatDate } from "@/components/ui";
import { formatUsd } from "@/server/money";
import { getConfirmation } from "@/server/suppliers/confirmations";
import { answerAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm a delivery", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A supplier's one-click answer to "did the charity receive what it paid you
 * for?". Opening the page never answers: link scanners in mail apps open links too.
 */
export default async function SupplierConfirmPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params;
  const { r } = await searchParams;
  const c = await getConfirmation(token);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-20 pt-12 sm:px-6">
        {!c ? (
          <Panel title="This link doesn't work" tone="neutral">
            It may have expired or been mistyped. If a charity paid you through Proven, the email has the right link.
          </Panel>
        ) : c.status !== "requested" && r !== "confirmed" && r !== "denied" ? (
          <Panel title="Already answered" tone="neutral">
            {c.supplierName} already said {c.status === "confirmed" ? "the order was handed over" : "this order isn't right"}. Each link is answered once, so nothing changed.
          </Panel>
        ) : c.status !== "requested" ? (
          <Panel title={c.status === "confirmed" ? "Thanks - delivery confirmed" : "Thanks - we'll look into it"} tone={c.status === "confirmed" ? "proven" : "neutral"}>
            {c.status === "confirmed"
              ? `You confirmed ${c.charityName} received ${c.description}. Donors can now be charged for it.`
              : `You told us the order from ${c.charityName} isn't right. A Proven reviewer checks it, and donors aren't charged on it in the meantime.`}
          </Panel>
        ) : (
          <div className="rise-in rounded-[10px] border border-line bg-card p-6">
            <p className="text-sm text-ink-muted">Delivery check for {c.supplierName}</p>
            <h1 className="mt-1 font-serif text-2xl leading-tight text-ink">Did {c.charityName} receive this order?</h1>
            <dl className="mt-5 space-y-2 rounded-[10px] bg-[#efece4] px-4 py-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Order</dt>
                <dd className="text-right text-ink">{c.description}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Paid to you with PayPal</dt>
                <dd className="whitespace-nowrap font-mono text-ink">{formatUsd(c.amountCents)}</dd>
              </div>
              {c.paidAt && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Paid on</dt>
                  <dd className="text-ink">{formatDate(c.paidAt)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-sm text-ink-muted">Donors are only charged once delivery is confirmed. Your answer is final and goes to Proven, not just the charity.</p>
            {r === "invalid" && (
              <p role="alert" className="mt-4 rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
                That didn&apos;t go through. Wait a minute and choose again.
              </p>
            )}
            <form action={answerAction.bind(null, token)} className="mt-5 flex flex-wrap gap-3">
              <button name="answer" value="confirmed" className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-transform active:scale-[0.97]">
                Yes - handed over or collected
              </button>
              <button name="answer" value="denied" className="rounded-full border border-[#f09595] px-5 py-2.5 text-sm text-[#a32d2d] transition-transform active:scale-[0.97]">
                No - this order isn&apos;t right
              </button>
            </form>
            <p className="mt-4 text-xs text-ink-muted">Not delivered yet? Leave this page - the link stays open until you answer, for 30 days.</p>
          </div>
        )}
        <p className="mt-6 text-xs text-ink-muted">PayPal sandbox demo - no real money moves.</p>
      </main>
    </>
  );
}

function Panel({ title, tone, children }: { title: string; tone: "proven" | "neutral"; children: React.ReactNode }) {
  return (
    <div className={`rise-in rounded-[10px] border px-6 py-6 ${tone === "proven" ? "border-proven/30 bg-proven-bg text-proven-text" : "border-line bg-card text-ink"}`}>
      <h1 className="font-serif text-2xl">{title}</h1>
      <p className={`mt-2 text-sm ${tone === "proven" ? "" : "text-ink-muted"}`}>{children}</p>
    </div>
  );
}
