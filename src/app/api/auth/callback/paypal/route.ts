import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import {
  STATE_COOKIE,
  charityUserFor,
  createSession,
  identityFromCode,
  sessionCookieName,
  statesMatch,
} from "@/server/auth/paypal-login";

export const dynamic = "force-dynamic";

// Step 2: PayPal sends the charity back here (this exact URL is registered with PayPal).
// This specific route takes precedence over Auth.js's catch-all handler.
export async function GET(req: NextRequest) {
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/signin?error=${error}`, appUrl()), 303);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("Cancelled");
  // The state must match the one we set for this browser: blocks forged sign-in links.
  if (!statesMatch(params.get("state"), req.cookies.get(STATE_COOKIE)?.value)) return fail("Expired");
  const code = params.get("code");
  if (!code) return fail("Failed");

  try {
    const identity = await identityFromCode(code);
    const userId = await charityUserFor(identity);
    if (!userId) return fail("NotOnboarded");
    const { token, expires } = await createSession(userId);
    const res = NextResponse.redirect(new URL("/dashboard", appUrl()), 303);
    res.cookies.delete(STATE_COOKIE);
    res.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: sessionCookieName().startsWith("__Secure-"),
      path: "/",
      expires,
    });
    return res;
  } catch (e) {
    console.error("PayPal sign-in failed", e instanceof Error ? e.message : e);
    return fail("Failed");
  }
}
