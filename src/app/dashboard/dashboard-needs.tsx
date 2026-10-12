"use client";

import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMemo, useState } from "react";
import { CopyLinkButton } from "@/components/motion/copy-link";
import { Select } from "@/components/motion/select";
import { ProgressBar } from "@/components/motion/progress-bar";

export type DashboardNeed = {
  id: string;
  title: string;
  amountCents: number;
  heldCents: number;
  capturedCents: number;
  donorCount: number;
  deadline: string; // ISO
  createdAt: string; // ISO
  status: string;
};

const DAY = 24 * 60 * 60 * 1000;
const usd = (c: number) => `$${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const TABS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "held", label: "Holding money" },
  { key: "review", label: "In review" },
  { key: "closed", label: "Closed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SORTS = [
  { key: "deadline", label: "Soonest deadline" },
  { key: "held", label: "Most held" },
  { key: "newest", label: "Newest" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open for funding", cls: "bg-[#e9edf5] text-ink" },
  funded: { label: "Funded - held", cls: "bg-held-bg text-held-text" },
  delivering: { label: "Delivering - held", cls: "bg-held-bg text-held-text" },
  in_review: { label: "In review", cls: "bg-review-bg text-review-text" },
  proven: { label: "Proven", cls: "bg-proven-bg text-proven-text" },
  not_proven: { label: "Not proven - holds released", cls: "bg-void-bg text-void-text" },
  cancelled: { label: "Cancelled", cls: "bg-void-bg text-void-text" },
};

function inTab(n: DashboardNeed, tab: Tab) {
  if (tab === "open") return n.status === "open";
  if (tab === "held") return n.heldCents > 0;
  if (tab === "review") return n.status === "in_review";
  if (tab === "closed") return ["proven", "not_proven", "cancelled"].includes(n.status);
  return true;
}

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-[#e9edf5] text-ink" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

function Actions({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/dashboard/needs/${id}`}
        className="inline-flex items-center rounded-full bg-ink px-3 py-1 text-xs text-paper transition-colors duration-(--duration-quick) hover:bg-ink-soft"
      >
        Manage
      </Link>
      <Link
        href={`/needs/${id}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-ink transition-colors duration-(--duration-quick) hover:border-ink-muted"
      >
        View public page
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
      </Link>
      <CopyLinkButton path={`/needs/${id}`} />
    </div>
  );
}

export function DashboardNeeds({ needs, now }: { needs: DashboardNeed[]; now: number }) {
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("deadline");

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, needs.filter((n) => inTab(n, t.key)).length])), [needs]);
  const shown = useMemo(() => {
    const list = needs.filter((n) => inTab(n, tab));
    return [...list].sort((a, b) =>
      sort === "held" ? b.heldCents - a.heldCents : sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.deadline.localeCompare(b.deadline),
    );
  }, [needs, tab, sort]);

  // What the charity should act on first: open needs whose deadline is close.
  const urgent = needs
    .filter((n) => ["open", "funded", "delivering"].includes(n.status))
    .map((n) => ({ n, days: Math.ceil((Date.parse(n.deadline) - now) / DAY) }))
    .filter((x) => x.days <= 3)
    .sort((a, b) => a.days - b.days);

  const compact = shown.length > 6;

  return (
    <div>
      <AnimatePresence>
        {urgent.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-[10px] border border-held/40 bg-held-bg/60 px-4 py-3"
            aria-label="Action needed"
          >
            <p className="text-xs font-medium text-held-text">Action needed</p>
            <ul className="mt-1.5 space-y-1 text-sm text-ink">
              {urgent.slice(0, 4).map(({ n, days }) => (
                <li key={n.id} className="flex flex-wrap justify-between gap-2">
                  <Link href={`/dashboard/needs/${n.id}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">{n.title}</Link>
                  <span className="font-mono text-xs text-held-text">
                    {days <= 0 ? "Deadline today" : `Deadline in ${days} ${days === 1 ? "day" : "days"}`} - {usd(n.heldCents)} held
                  </span>
                </li>
              ))}
            </ul>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-ink">Your needs</h2>
        <Select
          size="sm"
          label="Sort needs"
          value={sort}
          options={SORTS.map((x) => ({ value: x.key, label: x.label }))}
          onChange={(v) => setSort(v as Sort)}
        />
      </div>

      <LayoutGroup id="need-tabs">
        <div role="tablist" aria-label="Filter needs" className="mt-3 flex flex-wrap gap-1 rounded-full border border-line bg-[#efece4] p-1">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className="relative rounded-full px-3 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
              >
                {on && <motion.span layoutId="need-tab-pill" className="absolute inset-0 rounded-full bg-card shadow-[0_1px_0_rgba(15,30,61,0.08)]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <span className="relative">{t.label} <span className="font-mono text-ink-muted">{counts[t.key]}</span></span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-[10px] border border-dashed border-line px-5 py-8 text-sm text-ink-muted">
          {needs.length === 0 ? "Post your first need - give it a price, a deadline, and the proof you'll provide." : "Nothing here right now."}
        </p>
      ) : compact ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-card">
          <AnimatePresence initial={false}>
            {shown.map((n) => (
              <motion.li key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{n.title}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {usd(n.heldCents)} held of {usd(n.amountCents)} - deliver by {day(n.deadline)}
                  </p>
                </div>
                <Pill status={n.status} />
                <Actions id={n.id} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {shown.map((n, i) => (
              <motion.article
                key={n.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 28, delay: i * 0.05 } }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="rounded-[10px] border border-line bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-serif text-lg leading-snug text-ink">{n.title}</h3>
                  <Pill status={n.status} />
                </div>
                <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-y border-dashed border-line py-3 font-mono text-xs [&>dd]:text-right [&>dt]:whitespace-nowrap [&>dt]:text-ink-muted">
                  <dt>Needed</dt>
                  <dd>{usd(n.amountCents)}</dd>
                  <dt>Held from {n.donorCount} {n.donorCount === 1 ? "donor" : "donors"}</dt>
                  <dd>{usd(n.heldCents)}</dd>
                  <dt>Released to you</dt>
                  <dd>{usd(n.capturedCents)}</dd>
                  <dt>Deliver by</dt>
                  <dd>{day(n.deadline)}</dd>
                </dl>
                <ProgressBar pct={Math.round((n.heldCents / n.amountCents) * 100)} delay={0.15 + i * 0.05} />
                <div className="mt-4">
                  <Actions id={n.id} />
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
