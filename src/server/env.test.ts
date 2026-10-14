import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { trimEnv } = await import("./env");

describe("trimEnv", () => {
  it("removes stray spaces and line breaks from pasted settings", () => {
    process.env.PAYPAL_WEBHOOK_ID = "  WH-123\n";
    process.env.AUTH_URL = "https://example.test ";
    trimEnv();
    expect(process.env.PAYPAL_WEBHOOK_ID).toBe("WH-123");
    expect(process.env.AUTH_URL).toBe("https://example.test");
  });
});
