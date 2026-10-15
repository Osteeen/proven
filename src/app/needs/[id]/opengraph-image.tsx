import { OG_SIZE, ogImage } from "@/components/og-image";
import { getPublicNeed } from "@/server/needs/repo";
import { formatUsd } from "@/server/money";

export const alt = "A disaster-relief need on Proven";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * A need's link preview: what it buys, who asks, how much and by when. Only public
 * needs (live, active charity); anything else gets the general Proven preview.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const need = await getPublicNeed((await params).id);
  if (!need) {
    return ogImage({
      eyebrow: "Disaster relief, with PayPal",
      headline: "Give to disaster relief. You're only charged when delivery is proven.",
      detail: "PayPal holds your gift. The charity is paid only for what it proves it delivered.",
    });
  }
  const by = need.deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const title = need.title.length > 90 ? `${need.title.slice(0, 89)}…` : need.title;
  return ogImage({
    eyebrow: need.charityName.slice(0, 60),
    headline: title,
    detail: `${formatUsd(need.amountCents).replace(/\.00$/, "")} needed by ${by}. You're only charged when delivery is proven.`,
  });
}
