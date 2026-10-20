import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/pagination";
import { BackLink, SiteHeader } from "@/components/ui";
import { demoLoginEnabled } from "@/server/auth/demo-login";
import { answerStates, type AnswerState } from "@/server/demo/message-states";
import { getDb } from "@/server/db/client";
import { charities, donations, messages } from "@/server/db/schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Messages (demo)", robots: { index: false, follow: false } };

// Who each message is for. In real use each person gets theirs by email or text.
const AUDIENCES = {
  donor: { label: "To donors", tag: "To the donor", kinds: ["gift_held", "gift_added", "gift_proven", "gift_released", "gift_refunded"] },
  supplier: { label: "To suppliers", tag: "To the supplier", kinds: ["supplier_invite", "supplier_confirm_request"] },
  people: { label: "To people helped", tag: "To a person helped", kinds: ["recipient_check"] },
} as const;
type Audience = keyof typeof AUDIENCES;
const tagFor = (kind: string) => Object.values(AUDIENCES).find((a) => (a.kinds as readonly string[]).includes(kind))?.tag ?? "Message";

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
export default async function DemoInboxPage({ searchParams }: { searchParams: Promise<{ page?: string; to?: string }> }) {
  if (!demoLoginEnabled()) notFound();
  const db = getDb();
  const sp = await searchParams;
  const to: Audience | null = sp.to && sp.to in AUDIENCES ? (sp.to as Audience) : null;
  const ofAudience = to ? inArray(messages.kind, [...AUDIENCES[to].kinds]) : undefined;
  // Only mail about the seeded demo charity (a donor's gift, or a supplier it invited): the inbox is
  // public in demo mode, and mail carries private gift links.
  const demoOnly = and(eq(charities.isDemo, true), ofAudience);
  const [{ n: total } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .leftJoin(donations, eq(donations.id, messages.donationId))
    .innerJoin(charities, eq(charities.id, sql`coalesce(${messages.charityId}, ${donations.charityId})`))
    .where(demoOnly);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(Number(sp.page) || 1)), pages);
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
  const states = await answerStates(mail.map(({ message: m }) => ({ id: m.id, kind: m.kind, bodyText: m.bodyText })));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <BackLink href="/#demo">Back to the demo</BackLink>
        <div className="rise-in mt-3">
          <h1 className="font-serif text-3xl text-ink">Messages for donors, suppliers, and people helped</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            In real use, each person gets these by email or text. In this demo, you play every role. Open the message for the person you are playing and use its link.
          </p>
        </div>
        <nav aria-label="Who the messages are for" className="mt-5 flex flex-wrap gap-2 text-sm">
          {[{ key: null, label: "All" }, ...Object.entries(AUDIENCES).map(([key, a]) => ({ key, label: a.label }))].map((t) => {
            const on = (t.key ?? null) === to;
            return (
              <Link
                key={t.label}
                href={t.key ? `/demo/inbox?to=${t.key}` : "/demo/inbox"}
                aria-current={on ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 ${on ? "border-ink bg-ink text-paper" : "border-line text-ink hover:border-ink-muted"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-4 font-mono text-xs text-ink-muted">
          {total <= PER_PAGE ? `${total} ${total === 1 ? "message" : "messages"}` : `${from}-${from + mail.length - 1} of ${total} messages`} - newest first
        </p>
        {mail.length === 0 ? (
          <p className="mt-8 rounded-[10px] border border-dashed border-line px-5 py-8 text-sm text-ink-muted">No messages here yet. Give to a need, or pay a supplier as the charity, and the messages Proven sends appear here.</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {mail.map(({ message: m }, i) => (
              <li key={m.id} className="rise-in rounded-[10px] border border-line bg-card" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <details open={i === 0 && page === 1} className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 px-5 py-4">
                    <span className="min-w-0">
                      <span className="mb-1 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-[#efece4] px-2 py-0.5 font-mono text-[11px] text-ink-soft">{tagFor(m.kind)}</span>
                        {states.has(m.id) && <AnswerTag state={states.get(m.id)!} />}
                      </span>
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
        <Pagination page={page} pages={pages} href={(p) => `/demo/inbox?${to ? `to=${to}&` : ""}page=${p}`} />
      </main>
    </>
  );
}

const ANSWER: Record<AnswerState, { label: string; cls: string }> = {
  waiting: { label: "Waiting for a reply", cls: "bg-held-bg text-held-text" },
  yes: { label: "Answered: yes", cls: "bg-proven-bg text-proven-text" },
  no: { label: "Answered: no", cls: "bg-[#fcebeb] text-[#791f1f]" },
  expired: { label: "Link expired", cls: "bg-[#efece4] text-ink-muted" },
};

function AnswerTag({ state }: { state: AnswerState }) {
  const a = ANSWER[state];
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${a.cls}`}>{a.label}</span>;
}
