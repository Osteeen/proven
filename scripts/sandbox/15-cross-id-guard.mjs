// Sandbox test 15: after a reauthorize, a hold has TWO authorization IDs that can
// both capture. Does the invoice_id duplicate guard (test 13) hold ACROSS them?
// And do the two IDs share one remaining balance (no second hold)?
//   node --env-file=.env.local scripts/sandbox/15-cross-id-guard.mjs <ORDER_ID> <ORIGINAL_AUTH> <NEW_AUTH> <REMAINING_CENTS>
// Uses an already-reauthorized sandbox hold. Captures $1 on the new ID (refunded at
// the end), then tries the same invoice_id on the original, then tries to capture
// the full remaining amount on the original (should exceed what is left).

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_MERCHANT_ID, PAYPAL_PARTNER_ATTRIBUTION_ID } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing");
if (!PAYPAL_PARTNER_MERCHANT_ID) throw new Error("PAYPAL_PARTNER_MERCHANT_ID missing");

// Holds only sandbox IDs (tracking ID, merchant IDs, order IDs). No secrets.
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".state", "test7.json"); // reads the charity merchant ID only
const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const saveState = (s) => { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n"); };

// Published PayPal sandbox test card (developer.paypal.com/tools/sandbox/card-testing)
const TEST_CARD = { number: "4012000077777777", expiry: "2030-12", security_code: "123", name: "Proven Test Donor" };

async function getToken() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${json.error_description ?? json.error}`);
  return json.access_token;
}

function summarizeError(json) {
  if (!json) return "";
  const issues = (json.details ?? []).map((d) => d.issue).join(", ");
  return [json.name, json.message, issues && `[${issues}]`].filter(Boolean).join(" ");
}

// Unsigned assertion PayPal uses to say "acting on behalf of this seller".
function authAssertion(sellerMerchantId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: sellerMerchantId })}.`;
}

async function call(token, step, method, path, body, { requestId, sellerId } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  if (PAYPAL_PARTNER_ATTRIBUTION_ID) headers["PayPal-Partner-Attribution-Id"] = PAYPAL_PARTNER_ATTRIBUTION_ID;
  if (sellerId) headers["PayPal-Auth-Assertion"] = authAssertion(sellerId);
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const note = res.ok ? (json?.status ?? "") : summarizeError(json);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${note ? " - " + note : ""}`);
  return { status: res.status, ok: res.ok, json, debugId: res.headers.get("paypal-debug-id") };
}


const [orderId, original, renewed, remainingCents] = process.argv.slice(2);
if (!orderId || !original || !renewed || !remainingCents) throw new Error("usage: <ORDER_ID> <ORIGINAL_AUTH> <NEW_AUTH> <REMAINING_CENTS>");
const charity = loadState().sellerMerchantId;
const token = await getToken();
const usd = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const inv = randomUUID();
const c1 = await call(token, "capture $1.00 on NEW auth (invoice X)", "POST", `/v2/payments/authorizations/${renewed}/capture`,
  { amount: { currency_code: "USD", value: "1.00" }, final_capture: false, invoice_id: inv }, { requestId: randomUUID() });
const c2 = await call(token, "capture $1.00 on ORIGINAL auth, SAME invoice X, new request id", "POST", `/v2/payments/authorizations/${original}/capture`,
  { amount: { currency_code: "USD", value: "1.00" }, final_capture: false, invoice_id: inv }, { requestId: randomUUID() });
const left = Number(remainingCents) - 100;
const c3 = await call(token, `capture ${usd(left + 100)} on ORIGINAL (only ${usd(left)} should be left)`, "POST", `/v2/payments/authorizations/${original}/capture`,
  { amount: { currency_code: "USD", value: usd(left + 100) }, final_capture: false, invoice_id: randomUUID() }, { requestId: randomUUID() });
if (c1.ok) await call(token, "refund the $1.00 test capture", "POST", `/v2/payments/captures/${c1.json.id}/refund`,
  { amount: { currency_code: "USD", value: "1.00" }, invoice_id: randomUUID(), note_to_payer: "Proven sandbox test 15" }, { requestId: randomUUID(), sellerId: charity });
if (c3.ok) console.log("WARNING: over-capture across IDs was ACCEPTED - the two IDs are separate holds; capture id", c3.json.id);
console.log(!c2.ok ? "RESULT: duplicate invoice_id refused across authorization IDs - guard holds" : "RESULT: GUARD FAILED across IDs - second capture went through, id " + c2.json.id);
console.log(!c3.ok ? "RESULT: both IDs share one remaining balance" : "RESULT: separate balances");
