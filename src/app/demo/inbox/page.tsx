import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/pagination";
import { SiteHeader } from "@/components/ui";
import { demoLoginEnabled } from "@/server/auth/demo-login";
import { getDb } from "@/server/db/client";
import { charities, donations, messages } from "@/server/db/schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo inbox - Proven", robots: { index: false, follow: false } };

// Turns URLs in a plain-text email into links.
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
      {text.split(/(https?:\/\/\S+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} className="break-all text-ink underline underline-offset-4">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

const PER_PAGE = 10;

/**
 * Stands in for real inboxes in the sandbox demo: PayPal's test payers have
 * example.com addresses, so emails can't be delivered. Only exists in demo mode.
 */
export default async function DemoInboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!demoLoginEnabled()) notFound();
  const db = getDb();
  // Only mail about the seeded demo charity (a donor's gift, or a supplier it invited): the inbox is
  // public in demo mode, and mail carries private gift links.
  const demoOnly = eq(charities.isDemo, true);
  const [{ n: total } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .leftJoin(donations, eq(donations.id, messages.donationId))
    .innerJoin(charities, eq(charities.id, sql`coalesce(${messages.charityId}, ${donations.charityId})`))
    .where(demoOnly);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(Number((await searchParams).page) || 1)), pages);
  const mail = await db
    .select({ message: messages })
    .from(messages)
    .leftJoin(donations, eq(donations.id, messages.donationId))
    .innerJoin(charities, eq(charities.id, sql`coalesce(${messages.charityId}, ${donations.charityId})`))
    .where(demoOnly)
    .orderBy(desc(messages.createdAt))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <p className="rise-in inline-block rounded-full border border-dashed border-line px-3 py-1 text-xs text-ink-muted">
          Demo inbox - emails Proven would send, shown here because sandbox addresses can&apos;t receive mail
        </p>
        <div className="rise-in mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-serif text-3xl text-ink">Inbox</h1>
          <p className="font-mono text-xs text-ink-muted">
            {total === 0 ? "0 emails" : `${from}-${from + mail.length - 1} of ${total} ${total === 1 ? "email" : "emails"}`}
          </p>
        </div>
        {mail.length === 0 ? (
          <p className="mt-8 rounded-[10px] border border-dashed border-line px-5 py-8 text-sm text-ink-muted">No emails yet. Fund a need and the donor&apos;s email appears here.</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {mail.map(({ message: m }, i) => (
              <li key={m.id} className="rise-in rounded-[10px] border border-line bg-card" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <details open={i === 0 && page === 1} className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 px-5 py-4">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{m.subject}</span>
                      <span className="block text-xs text-ink-muted">To {m.toEmail}</span>
                    </span>
                    <span className="font-mono text-xs text-ink-muted">
                      {m.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                    </span>
                  </summary>
                  <div className="border-t border-dashed border-line px-5 py-4">{m.bodyText ? <Body text={m.bodyText} /> : null}</div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pages={pages} href={(p) => `/demo/inbox?page=${p}`} />
      </main>
    </>
  );
}
