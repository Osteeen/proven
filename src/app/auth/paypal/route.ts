import { NextResponse } from "next/server";
import { STATE_COOKIE, STATE_MAX_AGE, authorizeUrl, newState } from "@/server/auth/paypal-login";

export const dynamic = "force-dynamic";

// Step 1 of "Log in with PayPal": remember a one-time state value, then go to PayPal.
export async function GET() {
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(state), 303);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.AUTH_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
  return res;
}
