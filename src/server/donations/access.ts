import { createHash, randomBytes } from "node:crypto";

/** A donor's private status-page key: 32 random bytes. Only its hash is stored. */
export function newDonorKey(): { key: string; hash: string } {
  const key = randomBytes(32).toString("base64url");
  return { key, hash: hashDonorKey(key) };
}

export function hashDonorKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isWellFormedDonorKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key);
}
