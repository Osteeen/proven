// Sandbox test 11: a supplier on PayPal invoices the charity; the charity pays;
// Proven sees the payment in the CHARITY's transactions (permission it already granted).
// Note (Oct 2026): our partner app may not request INVOICE_READ_WRITE from sellers
// (FEATURES_UNAUTHORIZED), so the supplier sends the invoice from its own PayPal
// account and Proven only reads the charity's side. "invoice" below is kept for
// when PayPal enables that feature.
//
// SANDBOX ONLY. Keys come from the environment, never printed.
//   node --env-file=.env.local scripts/sandbox/11-supplier-invoice.mjs refer     -> supplier sign-up link
//   node --env-file=.env.local scripts/sandbox/11-supplier-invoice.mjs status    -> supplier onboarding + scopes
//   node --env-file=.env.local scripts/sandbox/11-supplier-invoice.mjs invoice   -> supplier sends $460 invoice to the charity
//   node --env-file=.env.local scripts/sandbox/11-supplier-invoice.mjs check     -> invoice status + charity's transactions

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_ENV !== "sandbox") throw new Error("PAYPAL_ENV must be 'sandbox' - refusing to run");
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_MERCHANT_ID } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_PARTNER_MERCHANT_ID) throw new Error("PayPal env vars missing");

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".state");
const STATE_FILE = join(STATE_DIR, "test11.json");
const load = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const save = (s) => { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n"); };
const charity = JSON.parse(readFileSync(join(STATE_DIR, "test7.json"), "utf8"));
const CHARITY_EMAIL = "sb-v7sp853112680@business.example.com";

async function token() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${j.error_description ?? j.error}`);
  return j.access_token;
}
const assertion = (merchantId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: PAYPAL_CLIENT_ID, payer_id: merchantId })}.`;
};
const errText = (j) => (j ? [j.name, j.message, (j.details ?? []).map((d) => d.issue).join(", ")].filter(Boolean).join(" ") : "");
async function call(tok, step, method, path, body, actAs) {
  const headers = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation" };
  if (method !== "GET") headers["PayPal-Request-Id"] = randomUUID();
  if (actAs) headers["PayPal-Auth-Assertion"] = assertion(actAs);
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${step}${res.ok ? (json?.status ? " - " + json.status : "") : " - " + errText(json)}`);
  return { ok: res.ok, status: res.status, json };
}

const cmd = process.argv[2];
const tok = await token();
const s = load();

if (cmd === "refer") {
  const trackingId = `proven-supplier-${Date.now()}`;
  const r = await call(tok, "create supplier partner referral", "POST", "/v2/customer/partner-referrals", {
    tracking_id: trackingId,
    operations: [{ operation: "API_INTEGRATION", api_integration_preference: { rest_api_integration: { integration_method: "PAYPAL", integration_type: "THIRD_PARTY", third_party_details: { features: ["PAYMENT", "REFUND", "ACCESS_MERCHANT_INFORMATION"] } } } }],
    products: ["PPCP"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
  });
  if (r.ok) {
    save({ ...s, trackingId });
    console.log(`\ntracking_id: ${trackingId}\nSign-up link (open in the "Proven supplier" Chrome profile, sign in as the supplier account):\n${r.json.links.find((l) => l.rel === "action_url").href}`);
  }
} else if (cmd === "status") {
  const look = await call(tok, "find supplier by tracking_id", "GET", `/v1/customer/partners/${PAYPAL_PARTNER_MERCHANT_ID}/merchant-integrations?tracking_id=${s.trackingId}`);
  const id = look.json?.merchant_id;
  if (!id) { console.log("No supplier linked yet."); process.exit(0); }
  if (id === PAYPAL_PARTNER_MERCHANT_ID || id === charity.sellerMerchantId) throw new Error("that is the platform or the charity account - use a separate supplier account");
  const info = await call(tok, "supplier integration", "GET", `/v1/customer/partners/${PAYPAL_PARTNER_MERCHANT_ID}/merchant-integrations/${id}`);
  const scopes = (info.json?.oauth_integrations ?? []).flatMap((o) => (o.oauth_third_party ?? []).flatMap((t) => t.scopes ?? []));
  console.log(JSON.stringify({ supplierMerchantId: id, payments_receivable: info.json?.payments_receivable, primary_email: info.json?.primary_email, invoiceScope: scopes.some((x) => x.includes("invoic")), scopes }, null, 2));
  save({ ...s, supplierMerchantId: id, supplierEmail: info.json?.primary_email });
} else if (cmd === "invoice") {
  if (!s.supplierMerchantId) throw new Error("run status first");
  const num = await call(tok, "generate invoice number (as supplier)", "POST", "/v2/invoicing/generate-next-invoice-number", {}, s.supplierMerchantId);
  const draft = await call(tok, "create draft invoice (as supplier)", "POST", "/v2/invoicing/invoices", {
    detail: {
      invoice_number: num.json?.invoice_number ?? `PRV-${Date.now()}`,
      currency_code: "USD",
      reference: "Proven need 0b585f6a-4baf-4920-b912-d167e41e011d",
      note: "50 wool blankets for the Riverbend shelter. Ref: Proven need 0b585f6a.",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: { business_name: "Proven Test Supplier (PayPal sandbox)" },
    primary_recipients: [{ billing_info: { email_address: CHARITY_EMAIL } }],
    items: [{ name: "Wool blanket", quantity: "50", unit_amount: { currency_code: "USD", value: "9.20" }, unit_of_measure: "QUANTITY" }],
  }, s.supplierMerchantId);
  const invoiceId = draft.json?.id ?? draft.json?.href?.split("/").pop();
  if (!invoiceId) process.exit(1);
  const sent = await call(tok, "send invoice to the charity (as supplier)", "POST", `/v2/invoicing/invoices/${invoiceId}/send`, { send_to_recipient: true, send_to_invoicer: false }, s.supplierMerchantId);
  const detail = await call(tok, "get invoice (as supplier)", "GET", `/v2/invoicing/invoices/${invoiceId}`, null, s.supplierMerchantId);
  const payLink = detail.json?.detail?.metadata?.recipient_view_url ?? sent.json?.href;
  save({ ...s, invoiceId, payLink });
  console.log(JSON.stringify({ invoiceId, status: detail.json?.status, total: detail.json?.amount?.value, payLink }, null, 2));
} else if (cmd === "check") {
  const inv = await call(tok, "get invoice (as supplier)", "GET", `/v2/invoicing/invoices/${s.invoiceId}`, null, s.supplierMerchantId);
  const payments = inv.json?.payments?.transactions ?? [];
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 864e5);
  const q = `start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&fields=transaction_info,payer_info&page_size=100`;
  const tx = await call(tok, "charity transactions (as charity)", "GET", `/v1/reporting/transactions?${q}`, null, charity.sellerMerchantId);
  const outgoing = (tx.json?.transaction_details ?? []).filter((t) => Number(t.transaction_info?.transaction_amount?.value) < 0);
  console.log(JSON.stringify({
    invoiceStatus: inv.json?.status,
    invoicePaid: inv.json?.payments?.paid_amount?.value ?? null,
    invoicePaymentIds: payments.map((p) => p.payment_id),
    charityOutgoingPayments: outgoing.map((t) => ({ id: t.transaction_info.transaction_id, amount: t.transaction_info.transaction_amount.value, code: t.transaction_info.transaction_event_code, invoiceId: t.transaction_info.invoice_id ?? null, at: t.transaction_info.transaction_initiation_date })),
    note: "Transaction Search can lag up to 3 hours behind.",
  }, null, 2));
} else {
  console.log("usage: refer | status | invoice | check");
}
