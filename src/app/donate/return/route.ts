import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import { DonationError, completeDonation } from "@/server/donations/service";

export const dynamic = "force-dynamic";

// PayPal sends the donor back here after they approve: ?k=<our key>&token=<order id>&PayerID=...
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("k");
  const orderId = req.nextUrl.searchParams.get("token");
  try {
    const result = await completeDonation(k, orderId);
    const to = new URL(`/d/${k}`, appUrl());
    if (result === "failed") to.searchParams.set("problem", "declined");
    if (result === "filled") to.searchParams.set("problem", "filled");
    return NextResponse.redirect(to, 303);
  } catch (e) {
    if (!(e instanceof DonationError)) console.error("donation return failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/donate/problem", appUrl()), 303);
  }
}
