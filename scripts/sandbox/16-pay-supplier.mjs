// Sandbox test 16: a charity pays its supplier THROUGH Proven with PayPal.
// Orders v2 intent=CAPTURE, payee = the supplier's PayPal email (no onboarding),
// payer = the charity, who approves on PayPal. Proven learns of the payment
// instantly because it created the order - no Transaction Search lag.
// SANDBOX ONLY.
//   node --env-file=.env.local scripts/sandbox/16-pay-supplier.mjs create <SUPPLIER_EMAIL or MERCHANT_ID>
//       -> prints an approval link: open it in the "Proven charity" Chrome profile and approve
//   node --env-file=.env.local scripts/sandbox/16-pay-supplier.mjs capture
// Finding (Oct 14): paying a supplier that has NOT connected PayPal to the platform
// fails at capture with 403 PAYEE_NOT_CONSENTED. The supplier connects once via
// Partner Referrals (scripts/sandbox/11-supplier-invoice.mjs refer), then it works.
//       -> captures, then reads back payer, payee and status

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
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".state", "test7.json");
const T16 = join(dirname(fileURLToPath(import.meta.url)), ".state", "test16.json"); // reads the charity merchant ID only
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


const save = (o) => { mkdirSync(dirname(T16), { recursive: true }); writeFileSync(T16, JSON.stringify(o, null, 2) + "\n"); };
const load = () => (existsSync(T16) ? JSON.parse(readFileSync(T16, "utf8")) : {});
const [cmd, supplierEmail] = process.argv.slice(2);
const token = await getToken();
const charityMerchant = loadState().sellerMerchantId;

if (cmd === "create") {
  if (!supplierEmail) throw new Error("usage: create <SUPPLIER_EMAIL>");
  const ref = randomUUID();
  const r = await call(token, "create order (CAPTURE, payee = supplier email)", "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: ref,
      invoice_id: ref,
      description: "Proven test 16: 20 wool blankets",
      amount: { currency_code: "USD", value: "10.00" },
      payee: supplierEmail.includes("@") ? { email_address: supplierEmail } : { merchant_id: supplierEmail },
    }],
    payment_source: { paypal: { experience_context: { brand_name: "Proven", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: "https://example.com/proven-return", cancel_url: "https://example.com/proven-cancel" } } },
  }, { requestId: randomUUID() });
  const approve = r.json?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  save({ orderId: r.json?.id, supplierEmail, createdAt: new Date().toISOString() });
  console.log("order", r.json?.id, "\nAPPROVE (Proven charity profile):", approve);
} else if (cmd === "capture") {
  const { orderId } = load();
  if (!orderId) throw new Error("run create first");
  const c = await call(token, "capture order", "POST", `/v2/checkout/orders/${orderId}/capture`, {}, { requestId: `${orderId}-capture` });
  const o = await call(token, "GET order", "GET", `/v2/checkout/orders/${orderId}`);
  const u = o.json?.purchase_units?.[0] ?? {};
  const cap = u.payments?.captures?.[0];
  const out = {
    orderStatus: o.json?.status,
    payerId: o.json?.payer?.payer_id,
    payerIsCharity: o.json?.payer?.payer_id === charityMerchant,
    payeeMerchantId: u.payee?.merchant_id,
    payeeEmail: u.payee?.email_address,
    captureId: cap?.id,
    captureStatus: cap?.status,
    amount: cap?.amount?.value,
    invoiceTagged: Boolean(cap?.invoice_id),
  };
  console.log(JSON.stringify(out, null, 2));
  save({ ...load(), result: out, capturedAt: new Date().toISOString() });
  void c;
} else throw new Error("usage: create <SUPPLIER_EMAIL> | capture");
