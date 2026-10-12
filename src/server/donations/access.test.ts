import { describe, expect, it } from "vitest";
import { hashDonorKey, isWellFormedDonorKey, newDonorKey } from "./access";

describe("donor keys", () => {
  it("issues a 43-character key and stores only its hash", () => {
    const { key, hash } = newDonorKey();
    expect(isWellFormedDonorKey(key)).toBe(true);
    expect(hash).toBe(hashDonorKey(key));
    expect(hash).not.toContain(key);
  });

  it("issues different keys every time", () => {
    expect(newDonorKey().key).not.toBe(newDonorKey().key);
  });

  it.each([undefined, "", "short", "x".repeat(44), "a".repeat(42) + "!"])("rejects malformed key %j", (k) => {
    expect(isWellFormedDonorKey(k)).toBe(false);
  });
});
