import Link from "next/link";
import { formatUsd } from "@/server/money";

type Tone = "neutral" | "held" | "proven" | "void" | "review";

const TONES: Record<Tone, string> = {
  neutral: "bg-[#e9edf5] text-ink",
  held: "bg-held-bg text-held-text",
  proven: "bg-proven-bg text-proven-text",
  void: "bg-void-bg text-void-text",
  review: "bg-review-bg text-review-text",
};

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors duration-(--duration-base) ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const NEED_STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  open: { tone: "neutral", label: "Open for funding" },
  funded: { tone: "held", label: "Funded - held, not charged" },
  delivering: { tone: "held", label: "Delivering - held, not charged" },
  in_review: { tone: "review", label: "In review" },
  proven: { tone: "proven", label: "Proven" },
  not_proven: { tone: "void", label: "Not proven - holds released" },
  cancelled: { tone: "void", label: "Cancelled - holds released" },
};

export function NeedStatus({ status }: { status: string }) {
  const s = NEED_STATUS[status] ?? { tone: "neutral" as const, label: status };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatUsd(cents)}</span>;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The Proven mark: a held (dashed amber) half becoming a proven (solid green) half, with a tick. */
export function ProvenMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <path d="M32 8 A24 24 0 0 0 32 56" fill="none" stroke="#b26b00" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 7.5" />
      <path d="M32 8 A24 24 0 0 1 32 56" fill="none" stroke="#1f7a4d" strokeWidth="5" strokeLinecap="round" />
      <path d="M20.5 33 L28.5 41 L44 23.5" fill="none" stroke="#0f1e3d" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const navLink = "hidden transition-colors duration-(--duration-quick) hover:text-ink sm:inline";

/** Public pages: Needs, How it works, and sign-in for charities (donors never sign in). */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
        <ProvenMark />
        Proven
      </Link>
      <nav className="flex items-center gap-5 text-sm text-ink-soft">
        <Link href="/needs" className={navLink}>Needs</Link>
        <Link href="/#how" className={navLink}>How it works</Link>
        {right ?? (
          <Link
            href="/signin"
            className="rounded-full border border-ink px-4 py-1.5 text-ink transition-colors duration-(--duration-quick) hover:bg-ink hover:text-paper"
          >
            For charities
          </Link>
        )}
      </nav>
    </header>
  );
}

/** Signed-in charity pages: their own links, never the public site's. */
export function CharityHeader({ signOut }: { signOut: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
        <ProvenMark />
        Proven
      </Link>
      <nav className="flex items-center gap-5 text-sm text-ink-soft">
        <Link href="/dashboard" className={navLink}>Dashboard</Link>
        <Link href="/dashboard/needs/new" className={navLink}>Post a need</Link>
        {signOut}
      </nav>
    </header>
  );
}

/** Reviewer pages: the queue only. */
export function ReviewerHeader({ signOut }: { signOut: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/review" className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
        <ProvenMark />
        Proven <span className="align-middle font-sans text-xs text-ink-muted">Review</span>
      </Link>
      <nav className="flex items-center gap-5 text-sm text-ink-soft">{signOut}</nav>
    </header>
  );
}

/** A clear way back: arrow, readable text, and a hover state that shows it is a link. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group -ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-ink-soft transition-colors duration-(--duration-quick) hover:bg-[#efece4] hover:text-ink"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-(--duration-quick) group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </Link>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-[transform,background-color] duration-(--duration-quick) ease-(--ease-out-soft) hover:bg-[#1b2f5c] active:scale-[0.98]"
    >
      {children}
    </Link>
  );
}

export function DemoBanner() {
  return (
    <p className="mx-auto mt-2 w-full max-w-5xl px-4 text-xs text-ink-muted sm:px-6">
      <span className="rounded-full border border-dashed border-line px-3 py-1">Demo account - PayPal sandbox, no real money</span>
    </p>
  );
}
