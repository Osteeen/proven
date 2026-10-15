import "server-only";

export type Listing = { title: string; priceCents: number; domain: string | null; url: string | null };

/**
 * Channel3 product search (one credit per call). Returns listings with a USD
 * price; anything else is dropped. The key comes from CHANNEL3_API_KEY on the
 * server only.
 */
export async function searchListings(query: string): Promise<Listing[]> {
  const key = process.env.CHANNEL3_API_KEY?.trim();
  if (!key) throw new Error("CHANNEL3_API_KEY is not set");
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 120) }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Channel3 search failed: ${res.status}`);
  const json = (await res.json()) as {
    products?: { title?: string; offers?: { url?: string; domain?: string; price?: { price?: number; currency?: string } }[] }[];
  };
  const out: Listing[] = [];
  for (const p of json.products ?? []) {
    const offer = p.offers?.find((o) => o.price?.currency === "USD" && typeof o.price.price === "number" && o.price.price > 0);
    if (!p.title || !offer?.price?.price) continue;
    out.push({ title: p.title.slice(0, 140), priceCents: Math.round(offer.price.price * 100), domain: offer.domain ?? null, url: offer.url ?? null });
  }
  return out.slice(0, 20);
}
