import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { allow } = await import("./rate-limit");

describe("allow", () => {
  it("lets requests through up to the limit, then refuses until the window ends", () => {
    const t = 1_000_000;
    expect(allow("k1", 2, 60_000, t)).toBe(true);
    expect(allow("k1", 2, 60_000, t + 1)).toBe(true);
    expect(allow("k1", 2, 60_000, t + 2)).toBe(false);
    expect(allow("k1", 2, 60_000, t + 60_000)).toBe(true);
  });
  it("counts each key separately", () => {
    expect(allow("a", 1, 60_000, 5)).toBe(true);
    expect(allow("b", 1, 60_000, 5)).toBe(true);
    expect(allow("a", 1, 60_000, 6)).toBe(false);
  });
});
