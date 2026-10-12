// Sandbox test 12: can one donor approval pay two recipients - part to the
// supplier, part to the charity - as holds? (Orders v2 with two purchase units.)
//
// SANDBOX ONLY. Keys come from the environment, never printed.
//   node --env-file=.env.local scripts/sandbox/12-multi-payee.mjs            -> try with a test card (no approval needed)
//   node --env-file=.env.local scripts/sandbox/12-multi-payee.mjs --continue <ORDER_ID>   -> after PayPal approval

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PayPal env vars missing");
const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".state");
const charityId = JSON.parse(readFileSync(join(STATE_DIR, "test7.json"), "utf8")).sellerMerchantId;
// --use-platform: stand in the platform account for the supplier (no supplier onboarded yet).
const usePlatform = process.argv.includes("--use-platform");
const supplierId = usePlatform ? process.env.PAYPAL_PARTNER_MERCHANT_ID : JSON.parse(readFileSync(join(STATE_DIR, "test11.json"), "utf8")).supplierMerchantId;
if (!supplierId) throw new Error("run test 11 refer + status first (needs the supplier merchant ID), or pass --use-platform");

// Published PayPal sandbox test card (developer.paypal.com/tools/sandbox/card-testing)
const TEST_CARD = { number: "4012000077777777", expiry: "2030-12", security_code: "123", name: "Proven Test Donor" };

async function token() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return j.access_token;
}
const assertion = (merchantId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: merchantId })}.`;
};
const errText = (j) => (j ? [j.name, j.message, (j.details ?? []).map((d) => `${d.issue}${d.field ? ` (${d.field})` : ""}`).join(", ")].filter(Boolean).join(" ") : "");
async function call(tok, step, method, path, body, actAs) {
  const headers = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (method !== "GET") headers["PayPal-Request-Id"] = randomUUID();
  if (actAs) headers["PayPal-Auth-Assertion"] = assertion(actAs);
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${res.ok ? (json?.status ? " - " + json.status : "") : " - " + errText(json)}`);
  return { ok: res.ok, status: res.status, json };
}

const units = [
  { reference_id: "supplier", description: "Blankets - paid to supplier", amount: { currency_code: "USD", value: "460.00" }, payee: { merchant_id: supplierId } },
  { reference_id: "charity", description: "Delivery costs - paid to charity", amount: { currency_code: "USD", value: "40.00" }, payee: { merchant_id: charityId } },
];

const tok = await token();
const idx = process.argv.indexOf("--continue");
let order;
if (idx > -1) {
  order = (await call(tok, "get order", "GET", `/v2/checkout/orders/${process.argv[idx + 1]}`)).json;
  if (order && !order.purchase_units?.[0]?.payments) order = (await call(tok, "authorize order", "POST", `/v2/checkout/orders/${order.id}/authorize`, {})).json;
} else {
  const card = await call(tok, "create 2-payee AUTHORIZE order (card)", "POST", "/v2/checkout/orders", { intent: "AUTHORIZE", purchase_units: units, payment_source: { card: TEST_CARD } });
  if (card.ok) order = card.json;
  else {
    const pp = await call(tok, "create 2-payee AUTHORIZE order (PayPal approval)", "POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: units,
      payment_source: { paypal: { experience_context: { user_action: "CONTINUE", shipping_preference: "NO_SHIPPING", return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" } } },
    });
    if (pp.ok) {
      const link = pp.json.links?.find((l) => l.rel === "payer-action")?.href;
      console.log(`\nApprove in the "Donor" Chrome profile, then rerun with --continue ${pp.json.id}\n${link}`);
    }
    process.exit(0);
  }
}

const auths = (order?.purchase_units ?? []).map((u) => ({ ref: u.reference_id, payee: u.payee?.merchant_id, auth: u.payments?.authorizations?.[0] }));
console.log("\nHOLDS\n" + JSON.stringify(auths.map((a) => ({ ref: a.ref, payee: a.payee, authId: a.auth?.id, status: a.auth?.status, amount: a.auth?.amount?.value })), null, 2));

// Tidy up: release both holds (each voided on its own payee's behalf).
for (const a of auths) {
  if (!a.auth?.id) continue;
  // Try as the platform first; a hold for an onboarded seller needs its Auth-Assertion.
  const plain = await call(tok, `void ${a.ref} hold (as platform)`, "POST", `/v2/payments/authorizations/${a.auth.id}/void`);
  if (!plain.ok && a.payee !== process.env.PAYPAL_PARTNER_MERCHANT_ID) await call(tok, `void ${a.ref} hold (with Auth-Assertion)`, "POST", `/v2/payments/authorizations/${a.auth.id}/void`, null, a.payee);
}
