import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/server/app-url";
import { createDemoSession, demoLoginEnabled } from "@/server/auth/demo-login";
import { sessionCookieName } from "@/server/auth/paypal-login";

export const dynamic = "force-dynamic";

/**
 * The homepage's "Open as the charity / reviewer" links: signs in to a demo
 * account and opens its page, in a new tab. A link (not a form) so it can open
 * in a new tab. Only follows clicks from Proven's own pages - another site can't
 * swap a visitor's session for a demo one - and only in demo mode.
 */
export async function GET(req: NextRequest) {
  if (!demoLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const role = req.nextUrl.searchParams.get("role");
  if (role !== "charity" && role !== "reviewer") return NextResponse.redirect(new URL("/signin", appUrl()), 303);
  // Browsers say where a click came from; anything but our own pages goes to the sign-in page instead.
  if (req.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.redirect(new URL("/signin", appUrl()), 303);

  const { token, expires } = await createDemoSession(role);
  const res = NextResponse.redirect(new URL(role === "reviewer" ? "/review" : "/dashboard", appUrl()), 303);
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieName().startsWith("__Secure-"),
    path: "/",
    expires,
  });
  return res;
}
