import "server-only";
import { getDb } from "@/server/db/client";
import { messages } from "@/server/db/schema";

export type MailKind = (typeof messages.kind.enumValues)[number];

export type Mail = {
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  donationId?: string;
  /** Set for mail a charity's action sends (supplier invites), so its demo inbox shows it. */
  charityId?: string;
};

/**
 * One way out for every email Proven sends. For the hackathon (sandbox: PayPal's
 * test payers have example.com addresses) mail goes to the in-app demo inbox.
 * A real provider plugs in here later; it would store only metadata, since a
 * body can carry a donor's private gift link.
 */
export async function sendMail(mail: Mail, db: Pick<ReturnType<typeof getDb>, "insert"> = getDb()): Promise<void> {
  const transport = process.env.MAIL_TRANSPORT ?? "demo_inbox";
  if (transport !== "demo_inbox") throw new Error(`Mail transport "${transport}" is not set up yet`);
  // `db` may be a transaction, so the message is saved with whatever it is about.
  await db.insert(messages).values({
    kind: mail.kind,
    toEmail: mail.to,
    subject: mail.subject,
    bodyText: mail.text,
    donationId: mail.donationId ?? null,
    charityId: mail.charityId ?? null,
    transport,
  });
}

/** "j***@personal.example.com" - enough for a donor to recognise, not to read out. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your PayPal email";
  return `${user[0]}***@${domain}`;
}
