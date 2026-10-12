// Sandbox test 14: refunds on a multiparty capture (charity as payee).
// Does refund need PayPal-Auth-Assertion? Does invoice_id stop a duplicate
// refund sent with a new request ID? Does GET order list refunds with our
// invoice_id (for reconciling)? What does over-refunding return?
// SANDBOX ONLY, test card, charity from test 7.
//   node --env-file=.env.local scripts/sandbox/14-refund-guard.mjs

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


const charity = loadState().sellerMerchantId;
if (!charity) throw new Error("run test 7 first");
const token = await getToken();
const created = await call(token, "create order (AUTHORIZE, card, charity payee)", "POST", "/v2/checkout/orders",
  { intent: "AUTHORIZE", purchase_units: [{ reference_id: "t14", amount: { currency_code: "USD", value: "100.00" }, payee: { merchant_id: charity } }], payment_source: { card: TEST_CARD } },
  { requestId: randomUUID() });
const auth = created.json?.purchase_units?.[0]?.payments?.authorizations?.[0];
const orderId = created.json.id;
const cap = await call(token, "capture $50", "POST", `/v2/payments/authorizations/${auth.id}/capture`,
  { amount: { currency_code: "USD", value: "50.00" }, final_capture: true, invoice_id: randomUUID() }, { requestId: randomUUID() });
const capId = cap.json.id;
const inv = randomUUID();
const body1 = { amount: { currency_code: "USD", value: "10.00" }, invoice_id: inv, note_to_payer: "Proven test refund" };
await call(token, "refund $10 WITHOUT assertion", "POST", `/v2/payments/captures/${capId}/refund`, body1, { requestId: randomUUID() });
const rid = randomUUID();
const r1 = await call(token, "refund $10 WITH assertion", "POST", `/v2/payments/captures/${capId}/refund`, body1, { requestId: rid, sellerId: charity });
await call(token, "same request id again (replay)", "POST", `/v2/payments/captures/${capId}/refund`, body1, { requestId: rid, sellerId: charity });
await call(token, "refund $10 again, NEW request id, SAME invoice_id", "POST", `/v2/payments/captures/${capId}/refund`, body1, { requestId: randomUUID(), sellerId: charity });
await call(token, "refund $45 (more than the $40 left)", "POST", `/v2/payments/captures/${capId}/refund`, { amount: { currency_code: "USD", value: "45.00" }, invoice_id: randomUUID() }, { requestId: randomUUID(), sellerId: charity });
const order = await call(token, "GET order", "GET", `/v2/checkout/orders/${orderId}`);
const pays = order.json?.purchase_units?.[0]?.payments ?? {};
console.log("captures:", (pays.captures ?? []).map((c) => ({ status: c.status, value: c.amount?.value })));
console.log("refunds:", (pays.refunds ?? []).map((r) => ({ status: r.status, value: r.amount?.value, invoiceMatches: r.invoice_id === inv })));
const c = await call(token, "GET capture", "GET", `/v2/payments/captures/${capId}`);
console.log("refund id from first call present:", Boolean(r1.json?.id), "capture status:", c.json?.status);
const rg = r1.json?.id ? await call(token, "GET refund (with assertion)", "GET", `/v2/payments/refunds/${r1.json.id}`, undefined, { sellerId: charity }) : null;
console.log("refund GET keys:", rg ? Object.keys(rg.json ?? {}).join(", ") : "-", "invoice matches:", rg?.json?.invoice_id === inv);
