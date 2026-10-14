import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import { requireCharity } from "@/server/auth/access";
import { cancelSupplierPayment } from "@/server/suppliers/service";

export const dynamic = "force-dynamic";

// The charity backed out on PayPal: nothing was paid.
export async function GET(req: NextRequest) {
  const ctx = await requireCharity();
  const needId = await cancelSupplierPayment(ctx, req.nextUrl.searchParams.get("p") ?? "");
  const to = new URL(needId ? `/dashboard/needs/${needId}` : "/dashboard", appUrl());
  if (needId) to.searchParams.set("paid", "cancelled");
  return NextResponse.redirect(to, 303);
}
