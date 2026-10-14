import "server-only";
import { getEnv } from "@/server/env";
import { toPayPalValue, type Cents } from "@/server/money";
import { paypalRequest } from "./client";

type Link = { href: string; rel: string };

/**
 * A one-time link a supplier uses to connect its PayPal business account to
 * Proven (Partner Referrals consent). Same request as sandbox test 11, which
 * the supplier completed in test 16.
 */
export async function createSupplierConnectLink(trackingId: string, returnUrl: string): Promise<string> {
  const res = await paypalRequest<{ links?: Link[] }>("POST", "/v2/customer/partner-referrals", {
    body: {
      tracking_id: trackingId,
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: ["PAYMENT", "REFUND", "ACCESS_MERCHANT_INFORMATION"] },
            },
          },
        },
      ],
      products: ["PPCP"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      partner_config_override: { return_url: returnUrl },
    },
  });
  const link = res.links?.find((l) => l.rel === "action_url")?.href;
  if (!link) throw new Error("PayPal returned no connect link");
  return link;
}

/** The supplier's PayPal merchant ID once it has connected, or null if it hasn't yet. */
export async function connectedMerchant(
  trackingId: string,
): Promise<{
  merchantId: string;
  paymentsReceivable: boolean;
  primaryEmail: string | null;
  primaryEmailConfirmed: boolean;
  legalName: string | null;
  country: string | null;
} | null> {
  const partner = getEnv().PAYPAL_PARTNER_MERCHANT_ID;
  const found = await paypalRequest<{ merchant_id?: string }>(
    "GET",
    `/v1/customer/partners/${encodeURIComponent(partner)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
  ).catch(() => null);
  if (!found?.merchant_id) return null;
  const info = await paypalRequest<{ payments_receivable?: boolean; primary_email?: string; primary_email_confirmed?: boolean; legal_name?: string; country?: string }>(
    "GET",
    `/v1/customer/partners/${encodeURIComponent(partner)}/merchant-integrations/${encodeURIComponent(found.merchant_id)}`,
  );
  return {
    merchantId: found.merchant_id,
    paymentsReceivable: info.payments_receivable === true,
    primaryEmail: info.primary_email ?? null,
    primaryEmailConfirmed: info.primary_email_confirmed === true,
    legalName: info.legal_name?.trim().slice(0, 120) || null,
    country: info.country?.trim().slice(0, 2) || null,
  };
}

/**
 * A payment from the charity to a connected supplier. The charity approves it on
 * PayPal; Proven captures it. invoice_id = our payment row ID (PayPal refuses a
 * second capture tagged the same, test 13).
 */
export async function createSupplierPaymentOrder(input: {
  paymentId: string;
  amountCents: Cents;
  supplierMerchantId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ orderId: string; approveUrl: string }> {
  const order = await paypalRequest<{ id: string; links?: Link[] }>("POST", "/v2/checkout/orders", {
    requestId: `${input.paymentId}-order`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.paymentId,
          invoice_id: input.paymentId,
          custom_id: input.paymentId,
          description: input.description.slice(0, 127),
          amount: { currency_code: "USD", value: toPayPalValue(input.amountCents) },
          payee: { merchant_id: input.supplierMerchantId },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Proven",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approve) throw new Error("PayPal order has no approval link");
  return { orderId: order.id, approveUrl: approve };
}

type OrderView = {
  id: string;
  status: string;
  payer?: { payer_id?: string };
  purchase_units?: {
    reference_id?: string;
    payee?: { merchant_id?: string };
    amount?: { value?: string };
    payments?: { captures?: { id: string; status: string; amount?: { value?: string } }[] };
  }[];
};

export async function getSupplierPaymentOrder(orderId: string) {
  const o = await paypalRequest<OrderView>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const u = o.purchase_units?.[0];
  const cap = u?.payments?.captures?.[0];
  return {
    status: o.status,
    payerId: o.payer?.payer_id ?? null,
    payeeMerchantId: u?.payee?.merchant_id ?? null,
    referenceId: u?.reference_id ?? null,
    amountValue: u?.amount?.value ?? null,
    capture: cap ? { id: cap.id, status: cap.status } : null,
  };
}

/** Takes the approved payment. Idempotent through the request ID. */
export async function captureSupplierPaymentOrder(orderId: string, requestId: string) {
  const o = await paypalRequest<OrderView>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { requestId, body: {} });
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: o.status, capture: cap ? { id: cap.id, status: cap.status } : null };
}

/** A supplier payment's current state on PayPal (COMPLETED, REFUNDED, PARTIALLY_REFUNDED, REVERSED...). */
export async function supplierCaptureStatus(captureId: string): Promise<string> {
  const c = await paypalRequest<{ status: string }>("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
  return c.status;
}
