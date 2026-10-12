// Week 1 sandbox test 1: authorize, capture less than authorized, several partial
// captures from one authorization, idempotent replay, void, capture-after-void.
//
// SANDBOX ONLY. Keys come from the environment, never printed:
//   node --env-file=.env.local scripts/sandbox/01-auth-partial-captures.mjs
//   node --env-file=.env.local scripts/sandbox/01-auth-partial-captures.mjs --continue <ORDER_ID>
//
// --continue is the fallback when card processing is not enabled on the app:
// the first run prints an approve link, a sandbox buyer approves it in the
// browser, then this resumes from the approved order.

import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV && process.env.PAYPAL_ENV !== "sandbox") {
  throw new Error("PAYPAL_ENV is not 'sandbox' - refusing to run");
}
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing from the environment");
}

// Published PayPal sandbox test card (developer.paypal.com/tools/sandbox/card-testing)
const TEST_CARD = { number: "4012000077777777", expiry: "2030-12", security_code: "123", name: "Proven Test Donor" };

const AUTH_TOTAL = "100.00";
const CAPTURE_1 = "40.00";
const CAPTURE_2 = "30.00";

const log = [];
const outDir = process.env.RESULTS_DIR;

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

async function call(token, step, method, path, body, requestId) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const entry = { step, method, path, status: res.status, debugId: res.headers.get("paypal-debug-id"), json };
  log.push(entry);
  const note = res.ok ? (json?.status ?? "") : summarizeError(json);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${note ? " - " + note : ""}`);
  return entry;
}

function authFromOrder(order) {
  return order?.purchase_units?.[0]?.payments?.authorizations?.[0];
}

async function main() {
  const token = await getToken();
  const continueIdx = process.argv.indexOf("--continue");
  let orderId = continueIdx > -1 ? process.argv[continueIdx + 1] : null;
  let order;

  if (!orderId) {
    const created = await call(token, "create order (AUTHORIZE, card)", "POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: "need-test-1", description: "Proven sandbox test need", amount: { currency_code: "USD", value: AUTH_TOTAL } }],
      payment_source: { card: TEST_CARD },
    }, randomUUID());

    if (!created.json?.id) {
      // Card path not available: fall back to buyer approval.
      const fallback = await call(token, "create order (AUTHORIZE, PayPal approval)", "POST", "/v2/checkout/orders", {
        intent: "AUTHORIZE",
        purchase_units: [{ reference_id: "need-test-1", amount: { currency_code: "USD", value: AUTH_TOTAL } }],
        payment_source: { paypal: { experience_context: { user_action: "CONTINUE", return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" } } },
      }, randomUUID());
      const approve = fallback.json?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
      console.log(`\nApprove with a sandbox BUYER account, then rerun with --continue ${fallback.json?.id}\n${approve?.href ?? "(no approve link)"}`);
      return;
    }
    orderId = created.json.id;
    order = created.json;
  } else {
    order = (await call(token, "get order", "GET", `/v2/checkout/orders/${orderId}`)).json;
  }

  if (!authFromOrder(order)) {
    order = (await call(token, "authorize order", "POST", `/v2/checkout/orders/${orderId}/authorize`, {}, randomUUID())).json;
  }
  const auth = authFromOrder(order);
  if (!auth) throw new Error("no authorization on the order - stopping");

  const payee = order.purchase_units?.[0]?.payee ?? {};
  const authId = auth.id;

  // Capture less than authorized, not final.
  const rid1 = randomUUID();
  const cap1 = await call(token, `capture 1: ${CAPTURE_1} of ${AUTH_TOTAL} (final_capture=false)`, "POST",
    `/v2/payments/authorizations/${authId}/capture`, { amount: { currency_code: "USD", value: CAPTURE_1 }, final_capture: false }, rid1);

  // Same request id again: must return the same capture, not charge twice.
  const cap1replay = await call(token, "capture 1 replay (same PayPal-Request-Id)", "POST",
    `/v2/payments/authorizations/${authId}/capture`, { amount: { currency_code: "USD", value: CAPTURE_1 }, final_capture: false }, rid1);

  // Second partial capture on the same authorization: decides funding model B.
  const cap2 = await call(token, `capture 2: ${CAPTURE_2} (final_capture=false)`, "POST",
    `/v2/payments/authorizations/${authId}/capture`, { amount: { currency_code: "USD", value: CAPTURE_2 }, final_capture: false }, randomUUID());

  const afterCaptures = await call(token, "get authorization after captures", "GET", `/v2/payments/authorizations/${authId}`);

  // Void the remainder: the "not proven" path for what is left on the hold.
  const voided = await call(token, "void remaining authorization", "POST", `/v2/payments/authorizations/${authId}/void`, null, randomUUID());
  const afterVoid = await call(token, "get authorization after void", "GET", `/v2/payments/authorizations/${authId}`);

  // A capture after void must be refused.
  const capAfterVoid = await call(token, "capture after void (should fail)", "POST",
    `/v2/payments/authorizations/${authId}/capture`, { amount: { currency_code: "USD", value: "1.00" }, final_capture: true }, randomUUID());

  const summary = {
    orderId,
    authorizationId: authId,
    authorizationExpires: auth.expiration_time,
    payeeMerchantId: payee.merchant_id ?? null,
    capture1: { id: cap1.json?.id, status: cap1.json?.status },
    capture1Replay: { id: cap1replay.json?.id, sameAsCapture1: cap1replay.json?.id === cap1.json?.id },
    capture2: { id: cap2.json?.id, status: cap2.json?.status, ok: cap2.status < 300 },
    authStatusAfterCaptures: afterCaptures.json?.status,
    voidHttpStatus: voided.status,
    authStatusAfterVoid: afterVoid.json?.status,
    captureAfterVoid: { httpStatus: capAfterVoid.status, error: summarizeError(capAfterVoid.json) },
  };
  console.log("\nSUMMARY\n" + JSON.stringify(summary, null, 2));

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/01-auth-partial-captures-${Date.now()}.json`, JSON.stringify({ summary, log }, null, 2));
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
