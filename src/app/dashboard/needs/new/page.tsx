import { BackLink, CharityHeader, DemoBanner } from "@/components/ui";
import { SignOutButton } from "@/components/motion/sign-out-button";
import { requireCharity } from "@/server/auth/access";
import { deadlineBounds } from "@/server/needs/input";
import { NeedForm } from "./need-form";

export default async function NewNeedPage() {
  const charity = await requireCharity();
  const bounds = deadlineBounds();

  return (
    <>
      <CharityHeader signOut={<SignOutButton />} />
      {charity.isDemo && <DemoBanner note="Needs you post in the demo are cleared after 2 days; any holds on them are cancelled." />}
      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-8 sm:px-6">
        <BackLink href="/dashboard">Back to dashboard</BackLink>
        <div className="rise-in mt-3">
          <p className="text-sm text-ink-muted">{charity.charityName}</p>
          <h1 className="font-serif text-3xl text-ink">Post a need</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Donors give straight away. PayPal holds their money and pays you only when the proof below checks out.
          </p>
        </div>
        <div className="rise-in mt-8" style={{ animationDelay: "100ms" }}>
          <NeedForm minDate={bounds.min} maxDate={bounds.max} today={bounds.today} />
        </div>
      </main>
    </>
  );
}
