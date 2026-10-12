// Week 1 sandbox test 8: can the platform read a charity's PayPal transactions
// (Transaction Search, ADVANCED_TRANSACTIONS_SEARCH granted at onboarding)?
// Read-only. Uses the charity onboarded in test 7 (.state/test7.json).
//
// SANDBOX ONLY. Keys come from the environment, never printed:
//   node --env-file=.env.local scripts/sandbox/08-charity-transactions.mjs
//
// Transaction Search lags up to 3 hours, so very recent captures may not show yet.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_MERCHANT_ID } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_PARTNER_MERCHANT_ID) throw new Error("PayPal env vars missing");

const state = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".state", "test7.json"), "utf8"));
const charityId = state.sellerMerchantId;
if (!charityId) throw new Error("no charity merchant ID - run test 7 first");
const knownCaptures = [state["pay_payee.merchant_id"]?.capture1?.id, state["pay_payee.merchant_id"]?.capture2?.id].filter(Boolean);

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

function authAssertion(sellerMerchantId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: sellerMerchantId })}.`;
}

function summarizeError(json) {
  if (!json) return "";
  const issues = (json.details ?? []).map((d) => d.issue).join(", ");
  return [json.name, json.message, issues && `[${issues}]`].filter(Boolean).join(" ");
}

async function call(token, step, path, asSeller) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (asSeller) headers["PayPal-Auth-Assertion"] = authAssertion(asSeller);
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${res.ok ? "" : " - " + summarizeError(json)}`);
  return { ok: res.ok, status: res.status, json };
}

const token = await getToken();

// 1. Exact scopes the charity granted (full names, not shortened).
const integ = await call(token, "charity integration (granted scopes)",
  `/v1/customer/partners/${PAYPAL_PARTNER_MERCHANT_ID}/merchant-integrations/${charityId}`);
const scopes = (integ.json?.oauth_integrations ?? []).flatMap((o) => (o.oauth_third_party ?? []).flatMap((t) => t.scopes ?? []));
console.log("granted scopes:\n  " + scopes.join("\n  "));

// 2. Transaction Search as the charity, last 30 days (max window is 31).
const end = new Date();
const start = new Date(end.getTime() - 30 * 864e5);
const q = `start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&fields=transaction_info&page_size=100`;
const asCharity = await call(token, "transactions as the charity (PayPal-Auth-Assertion)", `/v1/reporting/transactions?${q}`, charityId);
const asPlatform = await call(token, "transactions as the platform (no assertion)", `/v1/reporting/transactions?${q}`);
const balance = await call(token, "charity balances (PayPal-Auth-Assertion)", `/v1/reporting/balances?currency_code=USD`, charityId);

const list = (r) => (r.json?.transaction_details ?? []).map((t) => ({
  id: t.transaction_info?.transaction_id,
  code: t.transaction_info?.transaction_event_code,
  amount: t.transaction_info?.transaction_amount?.value,
  status: t.transaction_info?.transaction_status,
  at: t.transaction_info?.transaction_initiation_date,
}));
const charityTx = list(asCharity);
const platformTx = list(asPlatform);

const summary = {
  charityMerchantId: charityId,
  transactionSearchScopeGranted: scopes.some((s) => s.includes("reporting/search")),
  asCharity: { httpStatus: asCharity.status, count: charityTx.length, error: asCharity.ok ? null : summarizeError(asCharity.json) },
  knownTest7CapturesFound: knownCaptures.map((id) => ({ id, found: charityTx.some((t) => t.id === id) })),
  asPlatform: { httpStatus: asPlatform.status, count: platformTx.length },
  charityTxAlsoInPlatformList: charityTx.filter((t) => platformTx.some((p) => p.id === t.id)).length,
  charityBalance: balance.ok ? (balance.json?.balances ?? []).map((b) => `${b.currency}: ${b.total_balance?.value}`) : summarizeError(balance.json),
  charityTransactions: charityTx.slice(0, 10),
};
console.log("\nSUMMARY\n" + JSON.stringify(summary, null, 2));
