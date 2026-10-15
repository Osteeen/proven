import { BackLink, PrimaryLink, SiteHeader } from "@/components/ui";

export default function DonationProblemPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-20 pt-8 sm:px-6">
        <BackLink href="/needs">Back to needs</BackLink>
        <h1 className="rise-in mt-6 font-serif text-3xl text-ink">We couldn&apos;t confirm that donation</h1>
        <p className="rise-in mt-3 text-ink-soft" style={{ animationDelay: "80ms" }}>
          No money was held or charged. You can go back to the need and try again.
        </p>
        <div className="mt-6">
          <PrimaryLink href="/#needs">Back to needs</PrimaryLink>
        </div>
      </main>
    </>
  );
}
