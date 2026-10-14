// Sandbox test 17: can the final release pay the supplier in the same step?
// For charities with no money of their own: the charity approves the supplier's
// PayPal payment first; at release, Proven captures the donor's hold to the
// charity and IMMEDIATELY captures the pre-approved supplier payment.
// Questions:
//   1. Can a CAPTURE order the charity approved earlier be captured later (minutes/hours)?
//   2. Does it go through right after the donor money lands in the charity's account?
//   3. What does the charity's PayPal balance show before and after?
// Limit: sandbox business accounts have balances and backup funding, so this can't
// force the "charity has $0" case - it shows the sequence and timing work.
// SANDBOX ONLY.
//   node --env-file=.env.local scripts/sandbox/17-release-pays-supplier.mjs create
//       -> two approval links: donor order (Donor profile), supplier order (Proven charity profile)
//   node --env-file=.env.local scripts/sandbox/17-release-pays-supplier.mjs run
//       -> authorize donor, capture $10 to charity, capture supplier order at once, read balances, void the rest

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_ATTRIBUTION_ID } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing");

// Sandbox IDs only (no secrets).
const here = dirname(fileURLToPath(import.meta.url));
const T7 = join(here, ".state", "test7.json");
const T11 = join(here, ".state", "test11.json");
const T17 = join(here, ".state", "test17.json");
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
const save = (o) => { mkdirSync(dirname(T17), { recursive: true }); writeFileSync(T17, JSON.stringify(o, null, 2) + "\n"); };
const charity = read(T7).sellerMerchantId;
const supplier = read(T11).supplierMerchantId;
if (!charity || !supplier) throw new Error("needs .state/test7.json (charity) and .state/test11.json (connected supplier)");

async function getToken() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${json.error_description ?? json.error}`);
  return json.access_token;
}
const authAssertion = (seller) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: seller })}.`;
};
async function call(token, step, method, path, body, { requestId, sellerId } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  if (PAYPAL_PARTNER_ATTRIBUTION_ID) headers["PayPal-Partner-Attribution-Id"] = PAYPAL_PARTNER_ATTRIBUTION_ID;
  if (sellerId) headers["PayPal-Auth-Assertion"] = authAssertion(sellerId);
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const issues = (json?.details ?? []).map((d) => d.issue).join(", ");
  const note = res.ok ? (json?.status ?? "") : [json?.name, issues && `[${issues}]`].filter(Boolean).join(" ");
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${note ? " - " + note : ""} (${Date.now() - t0}ms)`);
  return { ok: res.ok, status: res.status, json };
}
const balance = async (token, label) => {
  const r = await call(token, `charity balance ${label}`, "GET", "/v1/reporting/balances?currency_code=USD", undefined, { sellerId: charity });
  const usd = r.json?.balances?.find((b) => b.currency === "USD");
  return usd ? { available: usd.available_balance?.value, total: usd.total_balance?.value } : null;
};
const experience = { brand_name: "Proven", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: "https://example.com/proven-return", cancel_url: "https://example.com/proven-cancel" };

const cmd = process.argv[2];
const token = await getToken();

if (cmd === "create") {
  const donorRef = randomUUID();
  const donor = await call(token, "donor order (AUTHORIZE $12, payee = charity)", "POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: donorRef, custom_id: donorRef, description: "Proven test 17: donation", amount: { currency_code: "USD", value: "12.00" }, payee: { merchant_id: charity } }],
    payment_source: { paypal: { experience_context: experience } },
  }, { requestId: randomUUID() });
  const supRef = randomUUID();
  const sup = await call(token, "supplier order (CAPTURE $10, charity pays supplier)", "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: supRef, invoice_id: supRef, description: "Proven test 17: supplier balance owed", amount: { currency_code: "USD", value: "10.00" }, payee: { merchant_id: supplier } }],
    payment_source: { paypal: { experience_context: experience } },
  }, { requestId: randomUUID() });
  const link = (r) => r.json?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  save({ donorOrder: donor.json?.id, supplierOrder: sup.json?.id, createdAt: new Date().toISOString() });
  console.log("\n1) DONOR approves (Donor profile):\n", link(donor));
  console.log("\n2) CHARITY approves the supplier payment (Proven charity profile):\n", link(sup));
  console.log("\nThen run:  ... 17-release-pays-supplier.mjs run");
} else if (cmd === "run") {
  const s = read(T17);
  if (!s.donorOrder || !s.supplierOrder) throw new Error("run create first");
  const before = await balance(token, "before");
  const sup0 = await call(token, "supplier order still approved?", "GET", `/v2/checkout/orders/${s.supplierOrder}`);
  const auth = await call(token, "authorize donor order", "POST", `/v2/checkout/orders/${s.donorOrder}/authorize`, {}, { requestId: `${s.donorOrder}-auth` });
  const authId = auth.json?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authId) throw new Error("no authorization - did the donor approve?");
  // The release: donor money to the charity...
  const capRef = randomUUID();
  const cap = await call(token, "release: capture $10 of the donor hold to the charity", "POST", `/v2/payments/authorizations/${authId}/capture`, {
    amount: { currency_code: "USD", value: "10.00" }, invoice_id: capRef, final_capture: false,
  }, { requestId: capRef });
  // ...and in the same step, the supplier payment the charity approved earlier.
  const t = Date.now();
  const supCap = await call(token, "same step: capture the pre-approved supplier payment", "POST", `/v2/checkout/orders/${s.supplierOrder}/capture`, {}, { requestId: `${s.supplierOrder}-capture` });
  const gapMs = Date.now() - t;
  const after = await balance(token, "after");
  const sc = supCap.json?.purchase_units?.[0]?.payments?.captures?.[0];
  // Clean up: release the rest of the donor hold (void needs the charity's assertion, on the original auth ID).
  await call(token, "void the rest of the donor hold", "POST", `/v2/payments/authorizations/${authId}/void`, undefined, { requestId: `${authId}-void`, sellerId: charity });
  const out = {
    minutesFromCreateToRun: Math.round((Date.now() - Date.parse(s.createdAt)) / 60000),
    supplierOrderStatusBefore: sup0.json?.status,
    donorCapture: { ok: cap.ok, status: cap.json?.status },
    supplierCapture: { ok: supCap.ok, http: supCap.status, status: sc?.status, payee: supCap.json?.purchase_units?.[0]?.payee?.merchant_id === supplier ? "supplier" : "?", payerIsCharity: supCap.json?.payer?.payer_id === charity },
    supplierCaptureMs: gapMs,
    charityBalance: { before, after },
  };
  console.log("\n" + JSON.stringify(out, null, 2));
  save({ ...s, result: out, ranAt: new Date().toISOString() });
} else throw new Error("usage: create | run");
