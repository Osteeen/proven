// Week 2 sandbox test 13: invoice_id as a double-capture guard, and reconciling
// our captures against GET order. SANDBOX ONLY, test card, charity from test 7.
//   node --env-file=.env.local scripts/sandbox/13-capture-invoice-guard.mjs

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


// Test 13: can PayPal itself stop a double capture after a lost reply?
// Capture with invoice_id = our capture row ID, then try a second capture with a
// NEW PayPal-Request-Id but the same invoice_id (what a retry after the
// Request-Id window would look like). Also checks that GET order shows our
// invoice_id on each capture, so we can reconcile against PayPal's own record.
const s = loadState();
const charity = s.sellerMerchantId;
if (!charity) throw new Error("run test 7 first (no charity merchant ID in state)");
const token = await getToken();
const created = await call(token, "create order (AUTHORIZE, card, charity payee)", "POST", "/v2/checkout/orders",
  { intent: "AUTHORIZE", purchase_units: [{ reference_id: "t13", amount: { currency_code: "USD", value: "100.00" }, payee: { merchant_id: charity } }], payment_source: { card: TEST_CARD } },
  { requestId: randomUUID() });
const auth = created.json?.purchase_units?.[0]?.payments?.authorizations?.[0];
if (!auth) throw new Error("no authorization");
const orderId = created.json.id;
const inv = randomUUID();
const c1 = await call(token, "capture $30 (invoice_id = X)", "POST", `/v2/payments/authorizations/${auth.id}/capture`,
  { amount: { currency_code: "USD", value: "30.00" }, final_capture: false, invoice_id: inv, custom_id: inv }, { requestId: randomUUID() });
const c2 = await call(token, "capture $30 again, NEW request id, SAME invoice_id", "POST", `/v2/payments/authorizations/${auth.id}/capture`,
  { amount: { currency_code: "USD", value: "30.00" }, final_capture: false, invoice_id: inv, custom_id: inv }, { requestId: randomUUID() });
const order = await call(token, "GET order", "GET", `/v2/checkout/orders/${orderId}`);
const caps = order.json?.purchase_units?.[0]?.payments?.captures ?? [];
console.log(`order shows ${caps.length} capture(s):`, caps.map((c) => ({ status: c.status, value: c.amount?.value, invoiceMatches: c.invoice_id === inv, customMatches: c.custom_id === inv, final: c.final_capture })));
const a = await call(token, "GET authorization", "GET", `/v2/payments/authorizations/${auth.id}`);
console.log("authorization keys:", Object.keys(a.json ?? {}).join(", "));
await call(token, "void remainder (with assertion)", "POST", `/v2/payments/authorizations/${auth.id}/void`, undefined, { requestId: randomUUID(), sellerId: charity });
console.log(c2.ok ? "RESULT: second capture went through - invoice_id does NOT guard" : "RESULT: PayPal refused the duplicate invoice_id - guard works");
void c1;
