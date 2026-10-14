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

// Settings pasted into a dashboard often carry a stray space or line break.
// Trimmed once, in place, so every reader of process.env sees the clean value.
const TRIMMED = [
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_PARTNER_MERCHANT_ID",
  "PAYPAL_PARTNER_ATTRIBUTION_ID",
  "PAYPAL_WEBHOOK_ID",
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "DEMO_LOGIN",
  "JOB_SECRET",
  "DEMO_CHARITY_TRACKING_ID",
  "DEMO_CHARITY_MERCHANT_ID",
] as const;

export function trimEnv(): void {
  for (const key of TRIMMED) {
    const v = process.env[key];
    if (typeof v === "string" && v !== v.trim()) process.env[key] = v.trim();
  }
}

export function getEnv(): Env {
  if (cached) return cached;
  trimEnv();
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
    // Shared with the GitHub Actions schedule that calls /api/jobs/daily.
    JOB_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    PAYPAL_WEBHOOK_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .refine((e) => process.env.NODE_ENV !== "production" || e.AUTH_URL.startsWith("https://"), {
    message: "must be https in production",
    path: ["AUTH_URL"],
  });

export function checkStartupEnv(): void {
  trimEnv();
  getEnv();
  const parsed = startupSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${keys}`);
  }
}
