import Link from "next/link";
import { NeedCard } from "@/components/need-card";
import { PrimaryLink, SiteHeader } from "@/components/ui";
import { listPublicNeeds } from "@/server/needs/repo";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", name: "Held", color: "border-held text-held", body: "You fund a need. PayPal holds the money on your account - you're not charged." },
  { n: "02", name: "Proved", color: "border-ink text-ink", body: "The charity delivers and shows it. At least two independent checks must agree." },
  { n: "03", name: "Settled", color: "border-proven text-proven", body: "Proven: you're charged only what was spent. Not proven: you're never charged." },
];

export default async function Home() {
  // The homepage shows the six most urgent; everything else lives on /needs.
  const { needs, total } = await listPublicNeeds({ limit: 6, sort: "deadline" });
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
        <section className="rise-in max-w-2xl pt-10 sm:pt-16">
          <h1 className="font-serif text-4xl leading-[1.12] text-ink sm:text-5xl">
            Give to disaster relief. You&apos;re only charged when delivery is proven.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
            Your PayPal payment is held, not taken. The charity is paid only after the receipt, the supplier, and the
            people who received the help confirm it arrived.
          </p>
          <div className="mt-7">
            <PrimaryLink href="#needs">See needs to fund</PrimaryLink>
          </div>
        </section>

        <section id="how" className="mt-16 grid gap-6 sm:grid-cols-3">
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

        <section id="needs" className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-ink">Needs to fund</h2>
              <p className="mt-1 text-sm text-ink-muted">The most urgent first. Each has a price, a deadline, and the proof that releases the money.</p>
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
