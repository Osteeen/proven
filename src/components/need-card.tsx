import Link from "next/link";
import { PROOF_LABELS, type ProofType } from "@/server/needs/input";
import { AnimatedMoney } from "./motion/animated-money";
import { ProgressBar } from "./motion/progress-bar";
import { Money, NeedStatus, formatDate } from "./ui";

export type NeedCardData = {
  id: string;
  title: string;
  charityName?: string;
  amountCents: number;
  heldCents: number;
  donorCount: number;
  deadline: Date;
  status: string;
  requiredProof: string[];
};

export function NeedCard({ need, href, index = 0 }: { need: NeedCardData; href: string; index?: number }) {
  const pct = Math.min(100, Math.round((need.heldCents / need.amountCents) * 100));
  return (
    <Link
      href={href}
      style={{ animationDelay: `${index * 60}ms` }}
      className="rise-in group block rounded-[10px] border border-line bg-card p-5 transition-[transform,border-color] duration-(--duration-base) ease-(--ease-out-soft) hover:-translate-y-0.5 hover:border-ink-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg leading-snug text-ink">{need.title}</h3>
          {need.charityName && <p className="mt-0.5 text-xs text-ink-muted">{need.charityName}</p>}
        </div>
        <NeedStatus status={need.status} />
      </div>
      <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-y border-dashed border-line py-3 font-mono text-xs [&>dt]:whitespace-nowrap">
        <dt className="text-ink-muted">Needed</dt>
        <dd className="text-right"><Money cents={need.amountCents} /></dd>
        <dt className="text-ink-muted">Held from {need.donorCount} {need.donorCount === 1 ? "donor" : "donors"}</dt>
        <dd className="text-right"><AnimatedMoney cents={need.heldCents} delay={0.1 + index * 0.06} /></dd>
        <dt className="text-ink-muted">Deliver by</dt>
        <dd className="text-right">{formatDate(need.deadline)}</dd>
        <dt className="text-ink-muted">Proof</dt>
        <dd className="text-right">{need.requiredProof.map((p) => PROOF_LABELS[p as ProofType] ?? p).join(" + ")}</dd>
      </dl>
      <ProgressBar pct={pct} delay={0.2 + index * 0.06} />
    </Link>
  );
}
