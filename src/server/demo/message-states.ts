import "server-only";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { recipientContacts, supplierConfirmations } from "@/server/db/schema";

export type AnswerState = "waiting" | "yes" | "no" | "expired";

const LINK = /\/(?:r|supplier\/confirm)\/([A-Za-z0-9_-]{43})/;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * For the demo messages page: whether each supplier or recipient question has
 * been answered yet. Matched through the link's token hash (only hashes are stored).
 */
export async function answerStates(msgs: { id: string; kind: string; bodyText: string | null }[]): Promise<Map<string, AnswerState>> {
  const byHash = new Map<string, string>();
  for (const m of msgs) {
    if (m.kind !== "recipient_check" && m.kind !== "supplier_confirm_request") continue;
    const token = m.bodyText?.match(LINK)?.[1];
    if (token) byHash.set(hash(token), m.id);
  }
  const out = new Map<string, AnswerState>();
  if (byHash.size === 0) return out;
  const hashes = [...byHash.keys()];
  const now = new Date();
  const db = getDb();
  const [people, suppliers] = await Promise.all([
    db.select({ h: recipientContacts.tokenHash, answer: recipientContacts.answer, expiresAt: recipientContacts.expiresAt }).from(recipientContacts).where(inArray(recipientContacts.tokenHash, hashes)),
    db.select({ h: supplierConfirmations.tokenHash, status: supplierConfirmations.status, expiresAt: supplierConfirmations.expiresAt }).from(supplierConfirmations).where(inArray(supplierConfirmations.tokenHash, hashes)),
  ]);
  for (const p of people) {
    const id = byHash.get(p.h!);
    if (id) out.set(id, p.answer ?? (p.expiresAt && p.expiresAt < now ? "expired" : "waiting"));
  }
  for (const s of suppliers) {
    const id = byHash.get(s.h);
    if (id) out.set(id, s.status === "confirmed" ? "yes" : s.status === "denied" ? "no" : s.expiresAt < now ? "expired" : "waiting");
  }
  return out;
}
