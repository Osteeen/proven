import "server-only";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

// Hackathon build: sandbox only. A live value fails validation on purpose.
const schema = z.object({
  PAYPAL_ENV: z.literal("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_PARTNER_MERCHANT_ID: z.string().min(1),
  PAYPAL_PARTNER_ATTRIBUTION_ID: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Name the keys only - never echo values.
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

// Everything the app needs to start. Checked once at server start (src/instrumentation.ts),
// so a deploy with a missing or unsafe value fails loudly instead of half-working.
const startupSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url(),
    DEMO_LOGIN: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
    PAYPAL_WEBHOOK_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .refine((e) => process.env.NODE_ENV !== "production" || e.AUTH_URL.startsWith("https://"), {
    message: "must be https in production",
    path: ["AUTH_URL"],
  });

export function checkStartupEnv(): void {
  getEnv();
  const parsed = startupSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }
}
