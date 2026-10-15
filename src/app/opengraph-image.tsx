import { OG_SIZE, ogImage } from "@/components/og-image";

export const alt = "Proven - give to disaster relief, only charged when delivery is proven";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The site-wide link preview. */
export default function Image() {
  return ogImage({
    eyebrow: "Disaster relief, with PayPal",
    headline: "Give to disaster relief. You're only charged when delivery is proven.",
    detail: "PayPal holds your gift. The charity is paid only for what it proves it delivered.",
  });
}
