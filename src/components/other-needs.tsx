import { listPublicNeeds } from "@/server/needs/repo";
import { NeedCard } from "./need-card";

/** "This need is covered" - point the donor at needs that still have room. */
export async function OtherNeeds({ excludeId, title }: { excludeId: string; title: string }) {
  const { needs } = await listPublicNeeds({ limit: 8, sort: "least_funded" });
  const open = needs.filter((n) => n.id !== excludeId && n.heldCents < n.amountCents).slice(0, 2);
  if (open.length === 0) return null;
  return (
    <section className="mt-6">
      {title && <p className="text-sm font-medium text-ink">{title}</p>}
      <div className="mt-3 grid gap-3">
        {open.map((n, i) => (
          <NeedCard key={n.id} need={n} href={`/needs/${n.id}`} index={i} />
        ))}
      </div>
    </section>
  );
}
