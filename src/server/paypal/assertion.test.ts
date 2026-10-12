import { describe, expect, it } from "vitest";
import { authAssertion } from "./assertion";

describe("authAssertion", () => {
  it("builds an unsigned JWT naming the platform and the seller", () => {
    const token = authAssertion("client-123", "SELLER456");
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({ iss: "client-123", payer_id: "SELLER456" });
    expect(signature).toBe("");
  });
});
