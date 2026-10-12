import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createSession } from "./paypal-login";

export const DEMO_ACCOUNTS = {
  charity: "demo-charity@proven.test",
  reviewer: "demo-reviewer@proven.test",
} as const;
export type DemoRole = keyof typeof DEMO_ACCOUNTS;

const DEMO_SESSION_SECONDS = 8 * 60 * 60;

export function demoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN === "true";
}

/**
 * Creates a normal database session for a seeded demo account, so judges can
 * try the app without a PayPal login. Refuses unless DEMO_LOGIN=true and the
 * account is flagged is_demo.
 */
export async function createDemoSession(role: DemoRole): Promise<{ token: string; expires: Date }> {
  if (!demoLoginEnabled()) throw new Error("Demo login is turned off");
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, DEMO_ACCOUNTS[role]), eq(users.isDemo, true)))
    .limit(1);
  if (!user) throw new Error("Demo account not seeded");
  return createSession(user.id, DEMO_SESSION_SECONDS);
}
