import { NextResponse, type NextRequest } from "next/server";
import { handleVerifiedEvent, verifyWebhook } from "@/server/paypal/webhooks";

export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;

// PayPal posts payment events here. Needs PAYPAL_WEBHOOK_ID (from the developer
// dashboard) and a public https URL, so it is live once deployed, not on 127.0.0.1.
export async function POST(req: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return NextResponse.json({ error: "webhooks not configured" }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let event: { id?: unknown; event_type?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.event_type !== "string") return NextResponse.json({ error: "bad event" }, { status: 400 });

  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, event, webhookId);
  } catch (e) {
    console.error("Webhook verification call failed", e instanceof Error ? e.message : e);
    // PayPal retries on non-2xx, which is what we want if PayPal itself was unreachable.
    return NextResponse.json({ error: "verification unavailable" }, { status: 502 });
  }
  if (!verified) return NextResponse.json({ error: "signature not verified" }, { status: 400 });

  try {
    const outcome = await handleVerifiedEvent(event as Parameters<typeof handleVerifiedEvent>[0]);
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    // Not marked done, so PayPal's retry processes it again.
    console.error("Webhook handling failed", { eventId: event.id, error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: "try again" }, { status: 500 });
  }
}
