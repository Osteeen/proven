import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Money is integer cents (USD only for the hackathon). Every row a charity can
// touch carries charity_id, and child rows are tied to their parent AND its
// charity by composite foreign keys, so a row can never point across charities.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const charityStatus = pgEnum("charity_status", ["pending", "active", "suspended"]);
export const trustTier = pgEnum("trust_tier", ["new", "established", "trusted"]);
export const needStatus = pgEnum("need_status", [
  "draft",
  "open",
  "funded",
  "delivering",
  "in_review",
  "proven",
  "not_proven",
  "cancelled",
]);
export const fundingModel = pgEnum("funding_model", ["reimbursement", "staged"]);
export const proofType = pgEnum("proof_type", ["receipt", "supplier_confirmation", "recipient_confirmation", "live_photo", "supplier_paypal_payment"]);
export const donationStatus = pgEnum("donation_status", [
  "pending_approval",
  "authorized",
  "partially_captured",
  "captured",
  "voided",
  "expired",
  "failed",
]);
export const captureStatus = pgEnum("capture_status", ["pending", "completed", "declined", "failed"]);
export const captureReason = pgEnum("capture_reason", ["booking_confirmed", "delivery_proven"]);
// Money totals count only "captured", "voided", "expired" and "refunded".
// "authorized", "reauthorized", "capture_requested" and "capture_failed" record
// steps that move no money - never add them into totals.
export const ledgerEvent = pgEnum("ledger_event", [
  "authorized",
  "reauthorized",
  "capture_requested",
  "captured",
  "capture_failed",
  "voided",
  "expired",
  "refunded",
]);
export const actorType = pgEnum("actor_type", ["system", "reviewer", "charity", "donor", "paypal_webhook"]);

export const charities = pgTable(
  "charities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Our own Partner Referrals tracking_id. A PayPal merchant can carry other
    // platforms' (or other projects') tracking IDs too, so we look up by ours.
    paypalTrackingId: text("paypal_tracking_id").notNull().unique(),
    paypalMerchantId: text("paypal_merchant_id").unique(),
    paymentsReceivable: boolean("payments_receivable").notNull().default(false),
    status: charityStatus("status").notNull().default("pending"),
    trustTier: trustTier("trust_tier").notNull().default("new"),
    // Releases above this amount always get a human review, even when checks pass.
    // Risk is controlled where money moves, not by capping what a charity can ask for.
    reviewReleasesAboveCents: integer("review_releases_above_cents").notNull().default(100_000),
    // Seeded sandbox stand-ins only. Demo reviewers (anyone, when DEMO_LOGIN is on) may act on these and nothing else.
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("charities_review_threshold_positive", sql`${t.reviewReleasesAboveCents} > 0`),
    check("charities_active_needs_merchant", sql`${t.status} <> 'active' or ${t.paypalMerchantId} is not null`),
  ],
);

export const needs = pgTable(
  "needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    charityId: uuid("charity_id")
      .notNull()
      .references(() => charities.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    fundingModel: fundingModel("funding_model").notNull().default("reimbursement"),
    requiredProof: proofType("required_proof").array().notNull(),
    status: needStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("needs_id_charity").on(t.id, t.charityId),
    index("needs_charity_status_idx").on(t.charityId, t.status),
    check("needs_amount_positive", sql`${t.amountCents} > 0`),
    check("needs_currency_usd", sql`${t.currency} = 'USD'`),
    // A PayPal hold lasts 29 days; the delivery deadline must fit inside it.
    check("needs_deadline_window", sql`${t.deadline} > ${t.createdAt} and ${t.deadline} <= ${t.createdAt} + interval '28 days'`),
    // Release needs at least two independent checks, so at least two proof types.
    check("needs_two_proofs", sql`cardinality(${t.requiredProof}) >= 2`),
    // At least one proof must come from someone other than the charity.
    check(
      "needs_independent_proof",
      sql`${t.requiredProof} && ARRAY['supplier_confirmation', 'supplier_paypal_payment', 'recipient_confirmation']::proof_type[]`,
    ),
  ],
);

export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    capturedCents: integer("captured_cents").notNull().default(0),
    // Charged money later given back. Never more than was charged.
    refundedCents: integer("refunded_cents").notNull().default(0),
    // Idempotency key for creating the PayPal order (PayPal-Request-Id).
    createRequestId: uuid("create_request_id").notNull().unique(),
    paypalOrderId: text("paypal_order_id").unique(),
    // The ORIGINAL authorization. Voids always go here: after a reauthorize, voiding
    // the new ID is refused, voiding the original cancels both (sandbox test 5).
    paypalAuthorizationId: text("paypal_authorization_id").unique(),
    // The authorization captures use. Set when Proven reauthorizes after the 3-day
    // honor period; null means "same as the original". History is in the ledger.
    captureAuthorizationId: text("capture_authorization_id").unique(),
    reauthorizeCount: integer("reauthorize_count").notNull().default(0),
    // A renewal is saved here BEFORE PayPal is called and reused on every retry,
    // so a lost reply can never turn into a second renewal.
    renewalRequestId: text("renewal_request_id"),
    renewalAmountCents: integer("renewal_amount_cents"),
    paypalPayerId: text("paypal_payer_id"),
    // Donors have no accounts: their gift page is reached by a private link.
    // Only a SHA-256 hash of the link key is stored. Top-ups reuse the same key,
    // so one link shows every hold the donor placed on that need.
    donorAccessHash: text("donor_access_hash").notNull(),
    // From PayPal when the hold is placed. Used only to send this donor updates
    // about this gift; never shown to the charity.
    donorEmail: text("donor_email"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    honorPeriodEndsAt: timestamp("honor_period_ends_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    status: donationStatus("status").notNull().default("pending_approval"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "donations_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    unique("donations_id_charity").on(t.id, t.charityId),
    unique("donations_id_need").on(t.id, t.needId),
    index("donations_charity_idx").on(t.charityId),
    index("donations_need_idx").on(t.needId),
    index("donations_hold_expiry_idx").on(t.holdExpiresAt),
    index("donations_donor_access_idx").on(t.donorAccessHash),
    check("donations_amount_positive", sql`${t.amountCents} > 0`),
    // Our own rule is stricter than PayPal's 115%: never capture more than the donor approved.
    check("donations_captured_within_hold", sql`${t.capturedCents} >= 0 and ${t.capturedCents} <= ${t.amountCents}`),
    check("donations_refund_within_charged", sql`${t.refundedCents} >= 0 and ${t.refundedCents} <= ${t.capturedCents}`),
  ],
);

// A request to take money from a need's holds: an "advance" (part on booking,
// staged needs only) or the "final" release after delivery, which also cancels
// whatever is left. New charities' first release and large releases wait for a
// reviewer. Only one release per need can be in flight at a time.
export const releaseKind = pgEnum("release_kind", ["advance", "final"]);
export const releaseStatus = pgEnum("release_status", ["pending_review", "approved", "executing", "completed", "failed", "rejected"]);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    kind: releaseKind("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: releaseStatus("status").notNull(),
    reviewReason: text("review_reason"),
    note: text("note"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "releases_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    unique("releases_id_charity").on(t.id, t.charityId),
    index("releases_status_idx").on(t.status),
    check("releases_amount_non_negative", sql`${t.amountCents} >= 0`),
    // One release in flight per need: a double click can't take money twice.
    uniqueIndex("releases_one_active_per_need")
      .on(t.needId)
      .where(sql`${t.status} in ('pending_review', 'approved', 'executing')`),
  ],
);

export const captures = pgTable(
  "captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: captureReason("reason").notNull(),
    finalCapture: boolean("final_capture").notNull().default(false),
    // PayPal-Request-Id: retrying the same capture reuses this, so PayPal never charges twice.
    requestId: uuid("request_id").notNull().unique(),
    releaseId: uuid("release_id"),
    paypalCaptureId: text("paypal_capture_id").unique(),
    status: captureStatus("status").notNull().default("pending"),
    refundedCents: integer("refunded_cents").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "captures_donation_charity_fk", columns: [t.donationId, t.charityId], foreignColumns: [donations.id, donations.charityId] }).onDelete("restrict"),
    unique("captures_id_charity").on(t.id, t.charityId),
    unique("captures_id_donation").on(t.id, t.donationId),
    foreignKey({ name: "captures_release_charity_fk", columns: [t.releaseId, t.charityId], foreignColumns: [releases.id, releases.charityId] }).onDelete("restrict"),
    index("captures_donation_idx").on(t.donationId),
    check("captures_amount_positive", sql`${t.amountCents} > 0`),
    check("captures_refund_within_amount", sql`${t.refundedCents} >= 0 and ${t.refundedCents} <= ${t.amountCents}`),
  ],
);

// ---------------------------------------------------------------------------
// Sign-in (Auth.js tables) and permissions. Property names follow what the
// Auth.js Drizzle adapter expects. Signing in only proves who someone is; what
// they may touch comes from user_role and memberships, never from the request.

export const userRole = pgEnum("user_role", ["member", "reviewer"]);
export const membershipRole = pgEnum("membership_role", ["charity_admin"]);

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  role: userRole("role").notNull().default("member"),
  // Seeded demo accounts for judges; only usable when DEMO_LOGIN=true.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    // For PayPal this is the payer ID, which equals the charity's merchant ID.
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    // PayPal's sign-in token carries all of the app's permissions; it must never be stored.
    check("accounts_no_stored_tokens", sql`${t.access_token} is null and ${t.refresh_token} is null and ${t.id_token} is null`),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    charityId: uuid("charity_id")
      .notNull()
      .references(() => charities.id, { onDelete: "restrict" }),
    role: membershipRole("role").notNull().default("charity_admin"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.charityId] }), index("memberships_charity_idx").on(t.charityId)],
);

// Emails Proven sends (gift held, later: proof updates, confirmations).
// In demo mode they are delivered to the in-app demo inbox, so the body is kept
// here; with a real email provider only the metadata would be stored, because
// bodies can carry private gift links.
export const messageKind = pgEnum("message_kind", ["gift_held", "gift_added", "gift_proven", "gift_released", "gift_refunded"]);
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: messageKind("kind").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    donationId: uuid("donation_id").references(() => donations.id, { onDelete: "restrict" }),
    transport: text("transport").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_created_idx").on(t.createdAt)],
);

// PayPal webhook events, stored once each (PayPal retries deliveries).
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  verified: boolean("verified").notNull(),
  outcome: text("outcome"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only audit trail of every money event. A trigger in the migrations
// rejects UPDATE and DELETE on this table.
export const refundStatus = pgEnum("refund_status", ["pending", "completed", "failed"]);

/**
 * Money given back from a capture. One reviewer action makes one row per
 * capture (same batch_id). The row ID is sent to PayPal as invoice_id, so
 * PayPal refuses a second refund for it (DUPLICATE_INVOICE_ID, sandbox test 14).
 */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull(),
    needId: uuid("need_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    donationId: uuid("donation_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    requestId: uuid("request_id").notNull().unique(),
    paypalRefundId: text("paypal_refund_id").unique(),
    status: refundStatus("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Set when the donor's refund email is queued, so each refund is emailed exactly once.
    donorNotifiedAt: timestamp("donor_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The capture really belongs to this donation, and the donation to this need.
    foreignKey({ name: "refunds_capture_donation_fk", columns: [t.captureId, t.donationId], foreignColumns: [captures.id, captures.donationId] }).onDelete("restrict"),
    foreignKey({ name: "refunds_donation_need_fk", columns: [t.donationId, t.needId], foreignColumns: [donations.id, donations.needId] }).onDelete("restrict"),
    foreignKey({ name: "refunds_capture_charity_fk", columns: [t.captureId, t.charityId], foreignColumns: [captures.id, captures.charityId] }).onDelete("restrict"),
    foreignKey({ name: "refunds_donation_charity_fk", columns: [t.donationId, t.charityId], foreignColumns: [donations.id, donations.charityId] }).onDelete("restrict"),
    foreignKey({ name: "refunds_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    index("refunds_need_idx").on(t.needId),
    index("refunds_batch_idx").on(t.batchId),
    check("refunds_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    charityId: uuid("charity_id")
      .notNull()
      .references(() => charities.id, { onDelete: "restrict" }),
    donationId: uuid("donation_id"),
    captureId: uuid("capture_id"),
    event: ledgerEvent("event").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paypalReference: text("paypal_reference"),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "ledger_donation_charity_fk", columns: [t.donationId, t.charityId], foreignColumns: [donations.id, donations.charityId] }).onDelete("restrict"),
    foreignKey({ name: "ledger_capture_charity_fk", columns: [t.captureId, t.charityId], foreignColumns: [captures.id, captures.charityId] }).onDelete("restrict"),
    index("ledger_charity_created_idx").on(t.charityId, t.createdAt),
    index("ledger_donation_idx").on(t.donationId),
    check("ledger_amount_non_negative", sql`${t.amountCents} >= 0`),
  ],
);
