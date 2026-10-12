// Sign-in check: does "Log in with PayPal" return a payer ID equal to the
// charity's merchant ID from Partner Referrals onboarding?
//
// SANDBOX ONLY. Keys come from the environment, never printed. Needs "Log in with
// PayPal" enabled on the sandbox app with this return URL:
//   http://127.0.0.1:3000/api/auth/callback/paypal
//
//   node --env-file=.env.local scripts/sandbox/10-login-with-paypal-check.mjs
//
// Starts a one-shot listener on 127.0.0.1:3000 for the callback, then exits
// (after one callback or 5 minutes). Prints only IDs and whether they match.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api-m.sandbox.paypal.com";
const AUTHORIZE = "https://www.sandbox.paypal.com/signin/authorize";
const REDIRECT_URI = "http://127.0.0.1:3000/api/auth/callback/paypal";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing");

const charityId = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".state", "test7.json"), "utf8")).sellerMerchantId;
const state = randomBytes(16).toString("hex");
const basic = "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");

const url = new URL(AUTHORIZE);
url.search = new URLSearchParams({
  flowEntry: "static",
  client_id: PAYPAL_CLIENT_ID,
  response_type: "code",
  scope: "openid email https://uri.paypal.com/services/paypalattributes",
  redirect_uri: REDIRECT_URI,
  state,
}).toString();

async function finish(code) {
  const tokenRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) return { step: "token exchange", status: tokenRes.status, error: tok.error_description ?? tok.error };
  const infoRes = await fetch(`${API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const info = await infoRes.json();
  if (!infoRes.ok) return { step: "userinfo", status: infoRes.status, error: info.error_description ?? info.name ?? info.error };
  return {
    scopesGranted: tok.scope,
    userId: info.user_id,
    payerId: info.payer_id ?? null,
    verifiedAccount: info.verified_account ?? null,
    emailCount: (info.emails ?? []).length,
    charityMerchantId: charityId,
    payerIdMatchesCharity: info.payer_id === charityId,
  };
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1:3000");
  if (u.pathname !== "/api/auth/callback/paypal") { res.writeHead(404).end(); return; }
  if (u.searchParams.get("state") !== state) { res.writeHead(400).end("state mismatch"); return; }
  const code = u.searchParams.get("code");
  const result = code ? await finish(code) : { error: u.searchParams.get("error") ?? "no code" };
  res.writeHead(200, { "Content-Type": "text/plain" }).end("Done - you can close this tab and go back to Claude.");
  console.log("\nRESULT\n" + JSON.stringify(result, null, 2));
  server.close();
  clearTimeout(timer);
});

const timer = setTimeout(() => { console.log("Timed out after 5 minutes - no callback."); server.close(); }, 5 * 60 * 1000);
server.listen(3000, "127.0.0.1", () => {
  console.log("Open this link in the 'Proven charity' Chrome profile and sign in:\n" + url.toString());
});
