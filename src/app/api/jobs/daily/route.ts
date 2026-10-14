import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { markLapsedHolds } from "@/server/jobs/lapsed-holds";
import { sweepStuckProofs } from "@/server/proofs/service";
import { sweepRecipientChecks } from "@/server/proofs/recipients";
import { closeStaleDemoNeeds, refreshDemoNeeds } from "@/server/demo/needs";
import { sweepSupplierPayments } from "@/server/suppliers/service";

export const dynamic = "force-dynamic";

function authorized(header: string | null): boolean {
  const secret = process.env.JOB_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  // Hash both sides so the comparison takes the same time whatever the length.
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

// Called once a day by the GitHub Actions schedule (.github/workflows/daily-jobs.yml).
// Render's free tier has no cron jobs. Safe to call more often: every step is idempotent.
export async function POST(req: NextRequest) {
  // Same answer whether or not jobs are configured: callers learn nothing without the secret.
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const lapsed = await markLapsedHolds();
  const stuckProofs = await sweepStuckProofs();
  const supplierPayments = await sweepSupplierPayments();
  const recipientChecks = await sweepRecipientChecks();
  // Demo mode only: clear visitors' test needs, then top the seeded ones back up.
  const demoNeeds = process.env.DEMO_LOGIN === "true" ? { closed: await closeStaleDemoNeeds(), posted: await refreshDemoNeeds() } : null;
  console.info("Daily jobs", { lapsed, stuckProofs, supplierPayments, recipientChecks, demoNeeds });
  return NextResponse.json({ ok: true, lapsed, stuckProofs, supplierPayments, recipientChecks, demoNeeds });
}
