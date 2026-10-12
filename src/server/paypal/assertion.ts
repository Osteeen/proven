/**
 * PayPal-Auth-Assertion: an unsigned JWT that says the platform is acting on
 * behalf of an onboarded seller (here, a charity). Sandbox showed it is required
 * to void a multiparty authorization and to read a charity's transactions.
 */
export function authAssertion(clientId: string, sellerMerchantId: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: clientId, payer_id: sellerMerchantId })}.`;
}
