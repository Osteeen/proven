import type { Metadata } from "next";
import Link from "next/link";
import { NeedCard } from "@/components/need-card";
import { BackLink, SiteHeader } from "@/components/ui";
import { PUBLIC_SORTS, listPublicNeeds, type PublicSort } from "@/server/needs/repo";
import { NeedsToolbar } from "./needs-toolbar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Needs to fund - Proven" };

const PAGE = 12;

export default async function AllNeedsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; show?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 80);
  const sort: PublicSort = (PUBLIC_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as PublicSort) : "deadline";
  const show = Math.min(Math.max(Number(sp.show) || PAGE, PAGE), 200);
  const { needs, total } = await listPublicNeeds({ limit: show, q, sort });

  const more = new URLSearchParams({ ...(q ? { q } : {}), sort, show: String(show + PAGE) });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 sm:px-6">
        <BackLink href="/">Back to home</BackLink>
        <h1 className="rise-in mt-3 font-serif text-3xl text-ink sm:text-4xl">Needs to fund</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {total} open {total === 1 ? "need" : "needs"}. Each has a price, a deadline, and the proof that releases the money.
        </p>
        <NeedsToolbar q={q} sort={sort} />

        {needs.length === 0 ? (
          <p className="mt-8 rounded-[10px] border border-dashed border-line px-5 py-8 text-sm text-ink-muted">
            {q ? `No open needs match "${q}". Try another word.` : "No open needs right now. Charities post them as help is needed."}
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {needs.map((n, i) => (
              <NeedCard key={n.id} need={n} href={`/needs/${n.id}`} index={i % PAGE} />
            ))}
          </div>
        )}

        {needs.length < total && (
          <div className="mt-8 text-center">
            <Link href={`/needs?${more.toString()}`} scroll={false} className="rounded-full border border-ink px-5 py-2 text-sm text-ink transition-colors hover:bg-ink hover:text-paper">
              Show more ({total - needs.length} left)
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
