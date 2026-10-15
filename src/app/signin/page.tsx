import { demoLoginEnabled } from "@/server/auth/demo-login";
import { BackLink } from "@/components/ui";
import { demoSignIn } from "./actions";

const ERRORS: Record<string, string> = {
  NotOnboarded: "This PayPal account isn't connected to a charity on Proven yet.",
  Cancelled: "PayPal sign-in was cancelled. Nothing changed.",
  Expired: "That sign-in link expired or was already used. Try again.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed - please try again.") : null;
  const demo = demoLoginEnabled();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <div className="self-start">
        <BackLink href="/">Back to home</BackLink>
      </div>
      <h1 className="text-3xl font-semibold">Sign in to Proven</h1>
      <p className="opacity-80">Charities sign in with the PayPal business account that receives their donations.</p>
      {message && (
        <p role="alert" className="rounded-md border border-red-400 px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <a
        href="/auth/paypal"
        className="block w-full rounded-full bg-[#0070e0] px-4 py-3 text-center font-semibold text-white transition-[filter,transform] duration-(--duration-quick) hover:brightness-110 active:scale-[0.98]"
      >
        Log in with PayPal
      </a>
      {demo && (
        <section className="flex flex-col gap-3 rounded-md border border-dashed px-4 py-4">
          <p className="text-sm font-semibold">Demo login - PayPal sandbox only, no real money</p>
          <form action={demoSignIn}>
            <input type="hidden" name="role" value="charity" />
            <button type="submit" className="w-full rounded-full border px-4 py-2">
              Continue as Demo charity (PayPal sandbox)
            </button>
          </form>
          <form action={demoSignIn}>
            <input type="hidden" name="role" value="reviewer" />
            <button type="submit" className="w-full rounded-full border px-4 py-2">
              Continue as Demo reviewer
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
