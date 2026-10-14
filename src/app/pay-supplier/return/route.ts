import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import { requireCharity } from "@/server/auth/access";
import { SupplierError, completeSupplierPayment } from "@/server/suppliers/service";

export const dynamic = "force-dynamic";

// PayPal sends the charity back here after it approves paying a supplier: ?p=<our payment id>&token=<order id>.
// The charity comes from the session; the payment must be its own.
export async function GET(req: NextRequest) {
  const ctx = await requireCharity();
  let to = new URL("/dashboard", appUrl());
  try {
    const r = await completeSupplierPayment(ctx, req.nextUrl.searchParams.get("p") ?? "");
    if (r.needId) {
      to = new URL(`/dashboard/needs/${r.needId}`, appUrl());
      to.searchParams.set("paid", r.status);
    }
  } catch (e) {
    if (!(e instanceof SupplierError)) console.error("Supplier payment return failed", e instanceof Error ? e.constructor.name : e);
  }
  return NextResponse.redirect(to, 303);
}
