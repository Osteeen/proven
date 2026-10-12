import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import { cancelDonation } from "@/server/donations/service";

export const dynamic = "force-dynamic";

// The donor clicked cancel on PayPal. Nothing was held for this order.
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("k");
  const { needId, hasGift } = await cancelDonation(k, req.nextUrl.searchParams.get("token"));
  // A donor who cancelled a top-up goes back to their existing gift page.
  const to = new URL(hasGift ? `/d/${k}` : needId ? `/needs/${needId}` : "/", appUrl());
  if (needId || hasGift) to.searchParams.set("cancelled", "1");
  return NextResponse.redirect(to, 303);
}
