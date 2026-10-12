import Link from "next/link";

/** Numbered pages: "Previous 1 2 3 ... 9 Next". Plain links, so it works without JavaScript. */
export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  // Show the first, last, current and its neighbours; gaps become "...".
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...wanted].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1]! > 1) items.push("gap");
    items.push(p);
  });

  const base = "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-sm transition-colors duration-(--duration-quick)";
  return (
    <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`${base} border border-line text-ink hover:border-ink-muted`}>Previous</Link>
      ) : (
        <span className={`${base} border border-line text-ink-muted opacity-50`} aria-hidden="true">Previous</span>
      )}
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`g${i}`} className="px-1 text-ink-muted" aria-hidden="true">...</span>
        ) : (
          <Link
            key={it}
            href={href(it)}
            aria-current={it === page ? "page" : undefined}
            className={`${base} font-mono ${it === page ? "bg-ink text-paper" : "border border-line text-ink hover:border-ink-muted"}`}
          >
            {it}
          </Link>
        ),
      )}
      {page < pages ? (
        <Link href={href(page + 1)} className={`${base} border border-line text-ink hover:border-ink-muted`}>Next</Link>
      ) : (
        <span className={`${base} border border-line text-ink-muted opacity-50`} aria-hidden="true">Next</span>
      )}
    </nav>
  );
}
