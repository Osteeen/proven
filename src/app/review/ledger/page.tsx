import type { Metadata } from "next";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { BackLink, DemoBanner, ReviewerHeader } from "@/components/ui";
import { requireReviewer } from "@/server/auth/access";
import { LEDGER_MAX_ROWS, listLedger } from "@/server/releases/ledger";
import { LedgerGrid } from "./ledger-grid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger", robots: { index: false, follow: false } };

/** Every movement of donors' money, for reviewers and auditors. */
export default async function LedgerPage() {
  const reviewer = await requireReviewer();
  const { rows, more } = await listLedger(reviewer);
  return (
    <>
      <ReviewerHeader signOut={<SignOutButton />} current="ledger" />
      {reviewer.isDemo && <DemoBanner />}
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <BackLink href="/review">Back to review queue</BackLink>
        <div className="rise-in mt-3">
          <h1 className="font-serif text-3xl text-ink">Ledger</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Every hold, charge, release and refund, straight from Proven&apos;s append-only record. Totals by charity; donors stay anonymous.
          </p>
        </div>
        {more && (
          <p role="status" className="mt-4 max-w-2xl rounded-md border border-held/30 bg-held-bg px-3 py-2 text-sm text-held-text">
            Showing the newest {LEDGER_MAX_ROWS.toLocaleString("en-US")} entries. Older entries aren&apos;t shown here, and the totals below only cover these.
          </p>
        )}
        <div className="mt-6">
          <LedgerGrid rows={rows} />
        </div>
      </main>
    </>
  );
}
