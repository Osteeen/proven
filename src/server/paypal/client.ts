import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/server/env";
import { authAssertion } from "./assertion";

// Sandbox only for the hackathon; env validation also refuses anything else.
const BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string | undefined,
    readonly issues: string[],
    readonly debugId: string | null,
  ) {
    super(`PayPal ${status}${errorName ? ` ${errorName}` : ""}${issues.length ? ` [${issues.join(", ")}]` : ""}`);
    this.name = "PayPalError";
  }
}

let token: { value: string; expiresAt: number } | undefined;
let inflight: Promise<string> | undefined;

async function fetchToken(): Promise<string> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = getEnv();
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    // A hung call must end so the caller can check PayPal's record instead of waiting forever.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new PayPalError(res.status, "TOKEN_REQUEST_FAILED", [], res.headers.get("paypal-debug-id"));
  const json = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early.
  token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return token.value;
}

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  inflight ??= fetchToken().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

export type PayPalRequestOptions = {
  body?: unknown;
  /** Idempotency key. Required for every money-moving call; reuse it on retries. */
  requestId?: string;
  /** Merchant ID of the charity the platform is acting for (adds PayPal-Auth-Assertion). */
  actAsSeller?: string;
};

export async function paypalRequest<T>(method: "GET" | "POST" | "PATCH", path: string, opts: PayPalRequestOptions = {}): Promise<T> {
  const env = getEnv();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (method !== "GET") headers["PayPal-Request-Id"] = opts.requestId ?? randomUUID();
  if (env.PAYPAL_PARTNER_ATTRIBUTION_ID) headers["PayPal-Partner-Attribution-Id"] = env.PAYPAL_PARTNER_ATTRIBUTION_ID;
  if (opts.actAsSeller) headers["PayPal-Auth-Assertion"] = authAssertion(env.PAYPAL_CLIENT_ID, opts.actAsSeller);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const details = (json.details as { issue?: string }[] | undefined) ?? [];
    throw new PayPalError(
      res.status,
      json.name as string | undefined,
      details.map((d) => d.issue ?? "").filter(Boolean),
      res.headers.get("paypal-debug-id"),
    );
  }
  return json as T;
}
