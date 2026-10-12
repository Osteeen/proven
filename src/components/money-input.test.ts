import { describe, expect, it } from "vitest";
import { cleanAmount, groupAmount } from "./money-input";

describe("cleanAmount", () => {
  it("keeps digits and one dot", () => {
    expect(cleanAmount("$50,000")).toBe("50000");
    expect(cleanAmount("1.2.3")).toBe("1.23");
    expect(cleanAmount("abc")).toBe("");
  });
  it("allows at most two decimals and nine whole digits", () => {
    expect(cleanAmount("12.3456")).toBe("12.34");
    expect(cleanAmount("12345678901")).toBe("123456789");
  });
  it("keeps a trailing dot while typing", () => {
    expect(cleanAmount("120.")).toBe("120.");
  });
});

describe("groupAmount", () => {
  it("adds thousands separators", () => {
    expect(groupAmount("50000")).toBe("50,000");
    expect(groupAmount("1234567.5")).toBe("1,234,567.5");
    expect(groupAmount("999")).toBe("999");
    expect(groupAmount("1000.")).toBe("1,000.");
    expect(groupAmount("")).toBe("");
  });
});
