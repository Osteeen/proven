// Week 1 sandbox test 7: charity as multiparty payee via Partner Referrals.
// Also requests ADVANCED_TRANSACTIONS_SEARCH so the same onboarding covers test 8.
//
// SANDBOX ONLY. Keys come from the environment, never printed. Steps:
//   node --env-file=.env.local scripts/sandbox/07-charity-payee.mjs refer
//       -> prints a one-time sign-up link. A person opens it and signs in with a
//          sandbox BUSINESS account that plays the charity (not the platform account).
//   node --env-file=.env.local scripts/sandbox/07-charity-payee.mjs status
//       -> finds the charity's merchant ID by tracking_id and checks onboarding.
//   node --env-file=.env.local scripts/sandbox/07-charity-payee.mjs pay [--continue <ORDER_ID>]
//       -> authorize $100 with the charity as payee, two partial captures, void.
//   node --env-file=.env.local scripts/sandbox/07-charity-payee.mjs pay --payee-email <sandbox business email>
//       -> fallback: same flow with payee.email_address instead of merchant_id.

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

// Try without the assertion first; if PayPal refuses on permissions, retry with it
// and record which one was needed.
async function callAsPlatform(token, step, method, path, body, sellerId, notes) {
  const first = await call(token, step, method, path, body, { requestId: randomUUID() });
  if (first.ok || !sellerId || ![401, 403].includes(first.status)) return first;
  notes.push(`${step}: needed PayPal-Auth-Assertion`);
  return call(token, `${step} (with PayPal-Auth-Assertion)`, method, path, body, { requestId: randomUUID(), sellerId });
}

async function refer(token) {
  const trackingId = `proven-charity-${Date.now()}`;
  const res = await call(token, "create partner referral", "POST", "/v2/customer/partner-referrals", {
    tracking_id: trackingId,
    operations: [{
      operation: "API_INTEGRATION",
      api_integration_preference: { rest_api_integration: {
        integration_method: "PAYPAL",
        integration_type: "THIRD_PARTY",
        third_party_details: { features: ["PAYMENT", "REFUND", "ACCESS_MERCHANT_INFORMATION", "ADVANCED_TRANSACTIONS_SEARCH"] },
      } },
    }],
    products: ["PPCP"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
  });
  if (!res.ok) return;
  const action = res.json.links?.find((l) => l.rel === "action_url")?.href;
  saveState({ ...loadState(), trackingId, referralCreatedAt: new Date().toISOString() });
  console.log(`\ntracking_id: ${trackingId}\nOne-time sign-up link (open in a browser, sign in with the sandbox CHARITY business account):\n${action}`);
}

async function status(token) {
  const state = loadState();
  if (!state.trackingId) throw new Error("no tracking_id saved - run 'refer' first");
  const lookup = await call(token, "find seller by tracking_id", "GET",
    `/v1/customer/partners/${PAYPAL_PARTNER_MERCHANT_ID}/merchant-integrations?tracking_id=${encodeURIComponent(state.trackingId)}`);
  const sellerId = lookup.json?.merchant_id;
  if (!sellerId) { console.log("\nNo seller linked to this tracking_id yet - finish the sign-up link first."); return; }
  if (sellerId === PAYPAL_PARTNER_MERCHANT_ID) throw new Error("seller is the platform account itself - sign up with a different sandbox business account");
  const info = await call(token, "get seller integration", "GET",
    `/v1/customer/partners/${PAYPAL_PARTNER_MERCHANT_ID}/merchant-integrations/${sellerId}`);
  const j = info.json ?? {};
  const oauth = (j.oauth_integrations ?? []).map((o) => ({
    type: o.integration_type,
    scopes: (o.oauth_third_party ?? []).flatMap((t) => t.scopes ?? []).map((s) => s.split("/").pop()),
  }));
  const summary = {
    sellerMerchantId: sellerId,
    payments_receivable: j.payments_receivable,
    primary_email_confirmed: j.primary_email_confirmed,
    products: (j.products ?? []).map((p) => `${p.name}:${p.vetting_status ?? p.status ?? "?"}`),
    oauth,
  };
  console.log("\nSELLER STATUS\n" + JSON.stringify(summary, null, 2));
  saveState({ ...state, sellerMerchantId: sellerId, sellerStatus: summary, checkedAt: new Date().toISOString() });
}

async function pay(token) {
  const state = loadState();
  const emailIdx = process.argv.indexOf("--payee-email");
  const payeeEmail = emailIdx > -1 ? process.argv[emailIdx + 1] : null;
  const sellerId = payeeEmail ? null : state.sellerMerchantId;
  if (!payeeEmail && !sellerId) throw new Error("no charity merchant ID - run 'status' after onboarding, or pass --payee-email");
  const payee = payeeEmail ? { email_address: payeeEmail } : { merchant_id: sellerId };
  const notes = [];

  const continueIdx = process.argv.indexOf("--continue");
  let orderId = continueIdx > -1 ? process.argv[continueIdx + 1] : null;
  let order;

  if (!orderId) {
    const unit = { reference_id: "need-test-7", description: "Proven sandbox test need", amount: { currency_code: "USD", value: "100.00" }, payee };
    const created = await call(token, `create order (AUTHORIZE, card, payee ${payeeEmail ? "email" : "merchant_id"})`, "POST", "/v2/checkout/orders",
      { intent: "AUTHORIZE", purchase_units: [unit], payment_source: { card: TEST_CARD } }, { requestId: randomUUID() });
    if (!created.json?.id) {
      const fallback = await call(token, "create order (AUTHORIZE, PayPal approval)", "POST", "/v2/checkout/orders", {
        intent: "AUTHORIZE", purchase_units: [unit],
        payment_source: { paypal: { experience_context: { user_action: "CONTINUE", return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" } } },
      }, { requestId: randomUUID() });
      const approve = fallback.json?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
      console.log(`\nApprove with a sandbox BUYER (personal) account, then rerun: pay --continue ${fallback.json?.id}${payeeEmail ? ` --payee-email ${payeeEmail}` : ""}\n${approve?.href ?? "(no approve link)"}`);
      return;
    }
    orderId = created.json.id;
    order = created.json;
  } else {
    order = (await call(token, "get order", "GET", `/v2/checkout/orders/${orderId}`)).json;
  }

  if (!order?.purchase_units?.[0]?.payments?.authorizations?.[0]) {
    order = (await callAsPlatform(token, "authorize order", "POST", `/v2/checkout/orders/${orderId}/authorize`, {}, sellerId, notes)).json;
  }
  const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("no authorization on the order - stopping");
  const orderPayee = order.purchase_units[0].payee ?? {};

  const cap1 = await callAsPlatform(token, "capture 1: 40.00 of 100.00 (final_capture=false)", "POST",
    `/v2/payments/authorizations/${auth.id}/capture`, { amount: { currency_code: "USD", value: "40.00" }, final_capture: false }, sellerId, notes);
  const cap2 = await callAsPlatform(token, "capture 2: 30.00 (final_capture=false)", "POST",
    `/v2/payments/authorizations/${auth.id}/capture`, { amount: { currency_code: "USD", value: "30.00" }, final_capture: false }, sellerId, notes);
  const capDetail = cap1.json?.id
    ? await callAsPlatform(token, "get capture 1 (who received the money)", "GET", `/v2/payments/captures/${cap1.json.id}`, null, sellerId, notes)
    : null;
  const afterCaptures = await callAsPlatform(token, "get authorization after captures", "GET", `/v2/payments/authorizations/${auth.id}`, null, sellerId, notes);
  const voided = await callAsPlatform(token, "void remaining authorization", "POST", `/v2/payments/authorizations/${auth.id}/void`, null, sellerId, notes);

  const capturePayee = capDetail?.json?.payee ?? cap1.json?.payee ?? {};
  const summary = {
    mode: payeeEmail ? "payee.email_address" : "payee.merchant_id",
    orderId,
    orderPayeeMerchantId: orderPayee.merchant_id ?? null,
    orderPayeeIsCharity: payeeEmail ? orderPayee.merchant_id !== PAYPAL_PARTNER_MERCHANT_ID : orderPayee.merchant_id === sellerId,
    authorizationId: auth.id,
    authorizationExpires: auth.expiration_time,
    capture1: { id: cap1.json?.id, status: cap1.json?.status ?? summarizeError(cap1.json) },
    capture2: { id: cap2.json?.id, status: cap2.json?.status ?? summarizeError(cap2.json) },
    capturePayeeMerchantId: capturePayee.merchant_id ?? null,
    moneyWentToPlatform: capturePayee.merchant_id === PAYPAL_PARTNER_MERCHANT_ID,
    sellerNet: capDetail?.json?.seller_receivable_breakdown?.net_amount?.value ?? null,
    authStatusAfterCaptures: afterCaptures.json?.status,
    voidStatus: voided.ok ? voided.json?.status ?? voided.status : summarizeError(voided.json),
    notes,
  };
  console.log("\nSUMMARY\n" + JSON.stringify(summary, null, 2));
  saveState({ ...state, [`pay_${summary.mode}`]: { ...summary, at: new Date().toISOString() } });
}

const cmd = process.argv[2];
const token = await getToken();
try {
  if (cmd === "refer") await refer(token);
  else if (cmd === "status") await status(token);
  else if (cmd === "pay") await pay(token);
  else console.log("usage: refer | status | pay [--continue ORDER_ID] [--payee-email EMAIL]");
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
