import Link from "next/link";
import { NeedCard } from "@/components/need-card";
import { PrimaryLink, SiteHeader } from "@/components/ui";
import { demoLoginEnabled } from "@/server/auth/demo-login";
import { listPublicNeeds } from "@/server/needs/repo";

export const dynamic = "force-dynamic";

// The real order of events for every need.
const STEPS = [
  { n: "01", name: "Held", color: "border-held text-held", body: "You give to a need. PayPal holds the amount on your account - nothing is taken yet." },
  {
    n: "02",
    name: "Bought",
    color: "border-ink text-ink",
    body: "The charity pays its supplier through Proven with PayPal, so there's a record of who was paid and how much.",
  },
  {
    n: "03",
    name: "Confirmed",
    color: "border-review text-review",
    body: "The delivery is confirmed by the receipt, the supplier, or a few of the people who got the help.",
  },
  { n: "04", name: "Settled", color: "border-proven text-proven", body: "You're charged only what was spent. If delivery can't be proven, the hold is cancelled and you pay nothing." },
];

/**
 * The demo, one card per person in the story, in the order things happen. Each
 * card opens that person's view directly - no hunting through pages.
 */
const DEMO_ROLES = [
  {
    who: "Donor",
    title: "Give to a need",
    body: "Choose a need and approve with a PayPal sandbox account - the login is in the project README. Your money is held, not taken.",
    href: "/needs",
    action: "See needs to fund",
  },
  {
    who: "Charity",
    title: "Buy, prove, get paid",
    body: "Pay the supplier through Proven, add the receipt, ask the people helped to confirm, then release only what you spent.",
    role: "charity" as const,
    action: "Open as the charity",
  },
  {
    who: "Supplier and people helped",
    title: "Confirm it arrived",
    body: "Proven emails the supplier and texts a few of the people helped to ask if it arrived. Read their messages and answer for them.",
    href: "/demo/inbox",
    action: "Open their messages",
  },
  {
    who: "Reviewer",
    title: "Step in when in doubt",
    body: "Verify new suppliers, decide on anything flagged, and refund donors if a delivery turns out to be false.",
    role: "reviewer" as const,
    action: "Open as the reviewer",
  },
];

export default async function Home() {
  // The homepage shows the six most urgent; everything else lives on /needs.
  const { needs, total } = await listPublicNeeds({ limit: 6, sort: "deadline" });
  const demo = demoLoginEnabled();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
        <section className="rise-in max-w-2xl pt-10 sm:pt-16">
          <h1 className="font-serif text-4xl leading-[1.12] text-ink sm:text-5xl">
            Give to disaster relief. You&apos;re only charged when delivery is proven.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
            When you give, PayPal holds your money instead of taking it. The charity buys what&apos;s needed through PayPal,
            and you&apos;re charged only once the delivery is confirmed.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-5">
            <PrimaryLink href="#needs">See needs to fund</PrimaryLink>
            {demo && (
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-full border border-held bg-held-bg px-5 py-2.5 text-sm text-held-text transition-colors hover:border-ink hover:text-ink"
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-held" />
                Try the demo - play every role
              </a>
            )}
          </div>
        </section>

        <section id="how" className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.n} className="rise-in" style={{ animationDelay: `${150 + i * 90}ms` }}>
              <div className={`border-t-2 pt-3 ${s.color.split(" ")[0]}`}>
                <p className={`font-mono text-sm ${s.color.split(" ")[1]}`}>
                  {s.n} {s.name}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            </div>
          ))}
        </section>

        {demo && (
          <section id="demo" className="rise-in mt-20 scroll-mt-6" style={{ animationDelay: "420ms" }}>
            <h2 className="font-serif text-2xl text-ink">Try the demo</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Try every side of Proven, in the order things happen. Each opens in a new tab. It all runs on PayPal&apos;s sandbox, so no real money moves.
            </p>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DEMO_ROLES.map((r, i) => (
                <li key={r.who} className="flex flex-col rounded-[10px] border border-line bg-card p-5">
                  <p className="font-mono text-xs text-ink-muted">
                    {String(i + 1).padStart(2, "0")} {r.who}
                  </p>
                  <h3 className="mt-2 font-serif text-lg leading-snug text-ink">{r.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-soft">{r.body}</p>
                  {/* Each role opens in its own tab, so this page stays as the map of the demo. */}
                  <div className="mt-4">
                    <a
                      href={"role" in r && r.role ? `/demo/enter?role=${r.role}` : r.href}
                      target="_blank"
                      rel="noopener"
                      className={`block w-full whitespace-nowrap rounded-full px-4 py-2.5 text-center text-sm transition-colors ${
                        "role" in r && r.role ? "bg-ink text-paper hover:bg-[#1b2f5c]" : "border border-ink text-ink hover:bg-[#eef1f7]"
                      }`}
                    >
                      {r.action}
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section id="needs" className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-ink">Needs to fund</h2>
              <p className="mt-1 text-sm text-ink-muted">Most urgent first. Each shows what it costs, when it must be delivered, and what has to be confirmed before you&apos;re charged.</p>
            </div>
            {total > needs.length && (
              <Link href="/needs" className="text-sm text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink">
                See all {total} needs
              </Link>
            )}
          </div>
          {needs.length === 0 ? (
            <p className="mt-8 rounded-[10px] border border-dashed border-line px-5 py-8 text-sm text-ink-muted">
              No open needs right now. Charities post them as help is needed.
            </p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {needs.map((n, i) => (
                <NeedCard key={n.id} need={n} href={`/needs/${n.id}`} index={i} />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-20 border-t border-line pt-6 text-xs text-ink-muted">
          Proven runs on the PayPal sandbox for this hackathon build. No real money moves.
        </footer>
      </main>
    </>
  );
}
