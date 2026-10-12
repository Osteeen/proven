// Week 1 sandbox test 5: reauthorize a hold after the 3-day honor period.
// Uses the charity onboarded in test 7 (.state/test7.json) as payee.
//
// SANDBOX ONLY. Keys come from the environment, never printed:
//   node --env-file=.env.local scripts/sandbox/05-reauthorize.mjs hold
//       -> $100 hold with the charity as payee, left OPEN, plus one early
//          reauthorize attempt (does sandbox enforce the honor period?).
//   node --env-file=.env.local scripts/sandbox/05-reauthorize.mjs status
//   node --env-file=.env.local scripts/sandbox/05-reauthorize.mjs reauth
//       -> after day 3: reauthorize, compare IDs and expiry, capture part of
//          the new hold, then void the rest.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing");

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".state");
const STATE_FILE = join(STATE_DIR, "test5.json");
const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const saveState = (s) => { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n"); };
const charityId = JSON.parse(readFileSync(join(STATE_DIR, "test7.json"), "utf8")).sellerMerchantId;
if (!charityId) throw new Error("no charity merchant ID - run test 7 first");

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

function authAssertion(sellerMerchantId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: sellerMerchantId })}.`;
}

async function call(token, step, method, path, body, { asSeller } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (method !== "GET") headers["PayPal-Request-Id"] = randomUUID();
  if (asSeller) headers["PayPal-Auth-Assertion"] = authAssertion(charityId);
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const note = res.ok ? (json?.status ?? "") : summarizeError(json);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${note ? " - " + note : ""}`);
  return { status: res.status, ok: res.ok, json };
}

// Try as the platform first; on a permission refusal retry on the charity's behalf.
async function callAsPlatform(token, step, method, path, body, notes) {
  const first = await call(token, step, method, path, body);
  if (first.ok || ![401, 403].includes(first.status)) return first;
  notes.push(`${step}: needed PayPal-Auth-Assertion`);
  return call(token, `${step} (with PayPal-Auth-Assertion)`, method, path, body, { asSeller: true });
}

const pick = (a) => a && { id: a.id, status: a.status, amount: a.amount?.value, expiration_time: a.expiration_time, create_time: a.create_time };

async function hold(token) {
  if (loadState().authorizationId) throw new Error("a test-5 hold already exists - use 'status' or 'reauth'");
  const notes = [];
  const created = await call(token, "create order (AUTHORIZE, card, payee = charity)", "POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: "need-test-5", description: "Proven sandbox reauthorize test", amount: { currency_code: "USD", value: "100.00" }, payee: { merchant_id: charityId } }],
    payment_source: { card: TEST_CARD },
  });
  const auth = created.json?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("no authorization on the order - stopping");
  saveState({ orderId: created.json.id, authorizationId: auth.id, original: pick(auth), createdAt: new Date().toISOString() });

  // Early attempt, inside the honor period.
  const early = await callAsPlatform(token, "early reauthorize (inside honor period)", "POST",
    `/v2/payments/authorizations/${auth.id}/reauthorize`, { amount: { currency_code: "USD", value: "100.00" } }, notes);
  const state = loadState();
  state.earlyAttempt = { httpStatus: early.status, result: early.ok ? pick(early.json) : summarizeError(early.json), notes, at: new Date().toISOString() };
  if (early.ok && early.json?.id) state.authorizationId = early.json.id; // sandbox allowed it: keep testing the newest hold
  saveState(state);

  const honorEnds = new Date(Date.parse(auth.create_time ?? state.createdAt) + 3 * 864e5).toISOString();
  console.log("\nSUMMARY\n" + JSON.stringify({ ...state, honorPeriodEnds: honorEnds }, null, 2));
}

async function status(token) {
  const state = loadState();
  if (!state.authorizationId) throw new Error("no test-5 hold yet - run 'hold'");
  const notes = [];
  const a = await callAsPlatform(token, "get authorization", "GET", `/v2/payments/authorizations/${state.authorizationId}`, null, notes);
  console.log(JSON.stringify({ current: pick(a.json), original: state.original, notes }, null, 2));
}

async function reauth(token) {
  const state = loadState();
  if (!state.authorizationId) throw new Error("no test-5 hold yet - run 'hold'");
  const notes = [];
  const before = await callAsPlatform(token, "get authorization before", "GET", `/v2/payments/authorizations/${state.authorizationId}`, null, notes);
  const re = await callAsPlatform(token, "reauthorize", "POST",
    `/v2/payments/authorizations/${state.authorizationId}/reauthorize`, { amount: { currency_code: "USD", value: "100.00" } }, notes);
  const newId = re.json?.id;
  const oldAfter = await callAsPlatform(token, "get original authorization after", "GET", `/v2/payments/authorizations/${state.authorizationId}`, null, notes);
  let cap = null, voided = null;
  if (re.ok && newId) {
    cap = await callAsPlatform(token, "capture 25.00 on the NEW authorization (final_capture=false)", "POST",
      `/v2/payments/authorizations/${newId}/capture`, { amount: { currency_code: "USD", value: "25.00" }, final_capture: false }, notes);
    voided = await callAsPlatform(token, "void the rest of the new authorization", "POST", `/v2/payments/authorizations/${newId}/void`, null, notes);
  }
  const summary = {
    before: pick(before.json),
    reauthorize: re.ok ? pick(re.json) : { httpStatus: re.status, error: summarizeError(re.json) },
    newIdDiffers: Boolean(newId && newId !== state.authorizationId),
    expiryUnchanged: Boolean(newId && re.json?.expiration_time === before.json?.expiration_time),
    originalAfter: pick(oldAfter.json),
    captureOnNew: cap && (cap.ok ? { id: cap.json?.id, status: cap.json?.status } : summarizeError(cap.json)),
    voidRest: voided && (voided.ok ? voided.json?.status ?? voided.status : summarizeError(voided.json)),
    notes,
  };
  console.log("\nSUMMARY\n" + JSON.stringify(summary, null, 2));
  saveState({ ...state, reauth: { ...summary, at: new Date().toISOString() } });
}

const cmd = process.argv[2];
const token = await getToken();
try {
  if (cmd === "hold") await hold(token);
  else if (cmd === "status") await status(token);
  else if (cmd === "reauth") await reauth(token);
  else console.log("usage: hold | status | reauth");
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
