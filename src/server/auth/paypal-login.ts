import "server-only";
import { appUrl } from "@/server/app-url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { accounts, charities, memberships, sessions, users } from "@/server/db/schema";
import { getEnv } from "@/server/env";

/**
 * "Log in with PayPal" for charities, done directly against PayPal's documented
 * flow (the same one verified in sandbox on Oct 9). Auth.js still owns sessions:
 * we write a normal row to its sessions table and set its session cookie.
 */

const AUTHORIZE = "https://www.sandbox.paypal.com/signin/authorize";
const API = "https://api-m.sandbox.paypal.com";
export const STATE_COOKIE = "proven_paypal_state";
export const STATE_MAX_AGE = 10 * 60;
export const SESSION_SECONDS = 12 * 60 * 60;


export const callbackUrl = () => `${appUrl()}/api/auth/callback/paypal`;

export function sessionCookieName(): string {
  return appUrl().startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function statesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    flowEntry: "static",
    client_id: getEnv().PAYPAL_CLIENT_ID,
    response_type: "code",
    scope: "openid email https://uri.paypal.com/services/paypalattributes",
    redirect_uri: callbackUrl(),
    state,
  }).toString();
  return url.toString();
}

type UserInfo = { user_id: string; payer_id?: string; name?: string; emails?: { value: string; primary?: boolean }[] };

/** Swap the one-time code for the PayPal identity. The access token is used once and dropped. */
export async function identityFromCode(code: string): Promise<{ payerId: string; email: string | null; name: string | null }> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = getEnv();
  const tokenRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    cache: "no-store",
  });
  if (!tokenRes.ok) {
    const j = (await tokenRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`PayPal code exchange failed: ${tokenRes.status} ${j.error ?? ""}`.trim());
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch(`${API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${access_token}` },
    cache: "no-store",
  });
  if (!infoRes.ok) throw new Error(`PayPal userinfo failed: ${infoRes.status}`);
  const info = (await infoRes.json()) as UserInfo;
  if (!info.payer_id) throw new Error("PayPal returned no payer ID");
  const email = info.emails?.find((e) => e.primary)?.value ?? info.emails?.[0]?.value ?? null;
  return { payerId: info.payer_id, email, name: info.name ?? null };
}

/**
 * Finds or creates the Proven user for this PayPal account and makes sure they
 * belong to the charity whose merchant ID equals the PayPal payer ID.
 * Returns undefined when no onboarded charity uses this PayPal account.
 */
export async function charityUserFor(identity: { payerId: string; email: string | null; name: string | null }): Promise<string | undefined> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [charity] = await tx
      .select({ id: charities.id })
      .from(charities)
      .where(and(eq(charities.paypalMerchantId, identity.payerId), eq(charities.status, "active")))
      .limit(1);
    if (!charity) return undefined;

    const [linked] = await tx
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.provider, "paypal"), eq(accounts.providerAccountId, identity.payerId)))
      .limit(1);
    let userId = linked?.userId;
    if (!userId) {
      // Email is informational only; identity is the PayPal payer ID.
      const [emailTaken] = identity.email
        ? await tx.select({ id: users.id }).from(users).where(eq(users.email, identity.email)).limit(1)
        : [];
      const [u] = await tx
        .insert(users)
        .values({ name: identity.name, email: emailTaken ? null : identity.email })
        .returning({ id: users.id });
      userId = u!.id;
      // No tokens stored - the table refuses them anyway.
      await tx.insert(accounts).values({ userId, type: "oauth", provider: "paypal", providerAccountId: identity.payerId });
    }
    await tx.insert(memberships).values({ userId, charityId: charity.id }).onConflictDoNothing();
    return userId;
  });
}

/** A normal Auth.js database session for this user. */
export async function createSession(userId: string, seconds = SESSION_SECONDS): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + seconds * 1000);
  await getDb().insert(sessions).values({ sessionToken: token, userId, expires });
  return { token, expires };
}
