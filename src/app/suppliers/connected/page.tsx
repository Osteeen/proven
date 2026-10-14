import type { Metadata } from "next";
import { SiteHeader } from "@/components/ui";
import { allow } from "@/server/rate-limit";
import { refreshSupplier } from "@/server/suppliers/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PayPal connected - Proven", robots: { index: false, follow: false } };

/**
 * Where PayPal sends a supplier after it connects. Suppliers have no Proven
 * account, so this page only says whether the connection went through.
 */
export default async function SupplierConnectedPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const s = (await searchParams).s;
  // Public page: each check is two PayPal calls on the shared app's quota, so reloads are limited.
  const mayAsk = typeof s === "string" && allow(`supplier-connected:${s}`, 6, 60_000) && allow("supplier-connected", 60, 60_000);
  const status = mayAsk ? await refreshSupplier(s).catch(() => "invited" as const) : "invited";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-20 pt-12 sm:px-6">
        {status === "connected" ? (
          <div className="rise-in rounded-[10px] border border-proven/30 bg-proven-bg px-6 py-6 text-proven-text">
            <h1 className="font-serif text-2xl">PayPal is connected</h1>
            <p className="mt-2 text-sm">Charities on Proven can now pay you with PayPal. The money goes straight to your PayPal account - Proven never holds it.</p>
          </div>
        ) : (
          <div className="rise-in rounded-[10px] border border-line bg-card px-6 py-6">
            <h1 className="font-serif text-2xl text-ink">Not connected yet</h1>
            <p className="mt-2 text-sm text-ink-muted">
              PayPal hasn&apos;t confirmed the connection. If you just finished, wait a minute and reload this page. To start again, use the link in the invite email.
            </p>
          </div>
        )}
        <p className="mt-6 text-xs text-ink-muted">PayPal sandbox demo - no real money moves.</p>
      </main>
    </>
  );
}
