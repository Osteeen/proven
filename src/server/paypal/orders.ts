import "server-only";
import { paypalRequest } from "./client";
import { toPayPalValue, type Cents } from "@/server/money";

type Link = { href: string; rel: string };
type Authorization = { id: string; status: string; expiration_time?: string; create_time?: string; amount?: { value: string } };
type Order = {
  id: string;
  status: string;
  links?: Link[];
  payer?: { payer_id?: string; email_address?: string };
  payment_source?: { paypal?: { email_address?: string; account_id?: string } };
  purchase_units?: { reference_id?: string; payee?: { merchant_id?: string }; payments?: { authorizations?: Authorization[] } }[];
};

/**
 * Creates a donor's order as a HOLD (intent AUTHORIZE) with the charity as payee,
 * so money never passes through Proven. The donor approves it on PayPal.
 */
export async function createHoldOrder(input: {
  donationId: string;
  requestId: string;
  amountCents: Cents;
  charityMerchantId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ orderId: string; approveUrl: string }> {
  const order = await paypalRequest<Order>("POST", "/v2/checkout/orders", {
    requestId: input.requestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.donationId,
          custom_id: input.donationId,
          description: input.description.slice(0, 127),
          amount: { currency_code: "USD", value: toPayPalValue(input.amountCents) },
          payee: { merchant_id: input.charityMerchantId },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Proven",
            user_action: "CONTINUE",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approve) throw new Error("PayPal order has no approval link");
  return { orderId: order.id, approveUrl: approve.href };
}

/**
 * Takes part or all of a hold. `final` tells PayPal no more captures follow, so
 * whatever is left on the hold is released. Idempotent through requestId, and
 * `invoiceId` (our capture row ID) makes PayPal refuse a second capture for the
 * same row even with a new request ID (DUPLICATE_TRANSACTION, sandbox test 13).
 * Platform capture needs no Auth-Assertion (verified in sandbox, test 7).
 */
export async function captureAuthorization(authorizationId: string, amountCents: Cents, final: boolean, requestId: string, invoiceId: string) {
  const res = await paypalRequest<{ id: string; status: string; final_capture?: boolean }>(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    {
      requestId,
      body: { amount: { currency_code: "USD", value: toPayPalValue(amountCents) }, final_capture: final, invoice_id: invoiceId, custom_id: invoiceId },
    },
  );
  return { captureId: res.id, status: res.status };
}

type Money = { value: string };
type OrderPayments = {
  purchase_units?: {
    payments?: {
      captures?: { id: string; status: string; invoice_id?: string; amount?: Money }[];
      refunds?: { id: string; status: string; invoice_id?: string; amount?: Money }[];
    };
  }[];
};

/** PayPal's own record of an order's captures and refunds, with the invoice IDs we tagged them with. */
export async function getOrderPayments(orderId: string) {
  const order = await paypalRequest<OrderPayments>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const units = order.purchase_units ?? [];
  const pick = (x: { id: string; status: string; invoice_id?: string; amount?: Money }) => ({ id: x.id, status: x.status, invoiceId: x.invoice_id, amountValue: x.amount?.value });
  return {
    captures: units.flatMap((u) => u.payments?.captures ?? []).map(pick),
    refunds: units.flatMap((u) => u.payments?.refunds ?? []).map(pick),
  };
}

/** PayPal's own record of the captures on an order. */
export async function getOrderCaptures(orderId: string) {
  return (await getOrderPayments(orderId)).captures;
}

/**
 * Gives charged money back to the donor. Sent on the charity's behalf (PayPal
 * refuses a platform refund of a multiparty capture without it - sandbox test
 * 14). `invoiceId` is our refund row ID: PayPal refuses a second refund with
 * it (DUPLICATE_INVOICE_ID), and a replay of the same requestId returns the
 * same refund.
 */
export async function refundCapture(paypalCaptureId: string, amountCents: Cents, requestId: string, invoiceId: string, charityMerchantId: string) {
  const res = await paypalRequest<{ id: string; status: string }>("POST", `/v2/payments/captures/${encodeURIComponent(paypalCaptureId)}/refund`, {
    requestId,
    actAsSeller: charityMerchantId,
    body: { amount: { currency_code: "USD", value: toPayPalValue(amountCents) }, invoice_id: invoiceId, note_to_payer: "Refund from Proven" },
  });
  return { refundId: res.id, status: res.status };
}

/** Cancels a hold. Multiparty voids must be sent on the charity's behalf (verified in sandbox). */
export async function voidAuthorization(authorizationId: string, charityMerchantId: string, requestId: string): Promise<void> {
  await paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    requestId,
    actAsSeller: charityMerchantId,
  });
}

/** Places the hold after the donor approved. Idempotent through requestId. */
export async function authorizeOrder(orderId: string, requestId: string) {
  const order = await paypalRequest<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    requestId,
    body: {},
  });
  const unit = order.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  if (!auth) throw new Error("PayPal returned no authorization");
  return {
    orderStatus: order.status,
    referenceId: unit?.reference_id,
    payeeMerchantId: unit?.payee?.merchant_id,
    payerId: order.payer?.payer_id,
    payerEmail: order.payer?.email_address ?? order.payment_source?.paypal?.email_address,
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    amountValue: auth.amount?.value,
    createTime: auth.create_time ? new Date(auth.create_time) : new Date(),
    expirationTime: auth.expiration_time ? new Date(auth.expiration_time) : undefined,
  };
}
