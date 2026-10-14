import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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
export const messageKind = pgEnum("message_kind", ["gift_held", "gift_added", "gift_proven", "gift_released", "gift_refunded", "supplier_invite", "supplier_confirm_request", "recipient_check"]);
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: messageKind("kind").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    donationId: uuid("donation_id").references(() => donations.id, { onDelete: "restrict" }),
    // For mail that isn't about a donation (supplier invites): which charity it concerns.
    charityId: uuid("charity_id").references(() => charities.id, { onDelete: "restrict" }),
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
/**
 * Proof a charity submits for a need. AI reads it; our own rules (not the AI)
 * decide the status. "needs_review" = a person must look. Proof never releases
 * money by itself - it is evidence for a release.
 */
export const proofStatus = pgEnum("proof_status", ["checking", "passed", "needs_review", "failed"]);

export const proofs = pgTable(
  "proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    kind: proofType("kind").notNull(),
    status: proofStatus("status").notNull().default("checking"),
    // Plain-language reasons for the status, shown to the charity and reviewer.
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    // What the AI read (merchant, date, items, total, match, warning signs).
    ai: jsonb("ai").$type<Record<string, unknown>>(),
    aiModel: text("ai_model"),
    // Verified spend from this proof, in cents (receipt total when it passed or was approved).
    amountCents: integer("amount_cents"),
    // Duplicate detection across ALL charities: exact image hash, and the receipt's own details.
    imageSha256: text("image_sha256"),
    fingerprint: text("fingerprint"),
    duplicateOf: uuid("duplicate_of"),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "proofs_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    unique("proofs_id_charity").on(t.id, t.charityId),
    index("proofs_need_idx").on(t.needId),
    index("proofs_image_idx").on(t.imageSha256),
    index("proofs_fingerprint_idx").on(t.fingerprint),
    check("proofs_amount_positive", sql`${t.amountCents} is null or ${t.amountCents} > 0`),
  ],
);

/**
 * Every way a receipt can be recognised again: receipt number + total, date +
 * total, shop + date + total. A new receipt matching ANY key of another proof is
 * flagged. Demo and real charities are kept in separate pools.
 */
export const proofFingerprints = pgTable(
  "proof_fingerprints",
  {
    proofId: uuid("proof_id")
      .notNull()
      .references(() => proofs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    isDemo: boolean("is_demo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.proofId, t.key] }), index("proof_fingerprints_key_idx").on(t.key, t.isDemo)],
);

/** The uploaded file, kept apart so listing proofs never loads image bytes. */
export const proofFiles = pgTable(
  "proof_files",
  {
    proofId: uuid("proof_id").primaryKey(),
    charityId: uuid("charity_id").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "proof_files_proof_charity_fk", columns: [t.proofId, t.charityId], foreignColumns: [proofs.id, proofs.charityId] }).onDelete("cascade"),
    check("proof_files_size", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 6000000`),
    check("proof_files_mime", sql`${t.mime} in ('image/jpeg', 'image/png', 'image/webp')`),
  ],
);

/**
 * Businesses charities buy from. A supplier connects its own PayPal business
 * account to Proven once (Partner Referrals consent); after that any charity can
 * pay it through Proven. PayPal refuses payments to a supplier that hasn't
 * connected (403 PAYEE_NOT_CONSENTED, sandbox test 16).
 */
export const supplierStatus = pgEnum("supplier_status", ["invited", "connected", "rejected"]);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // The PayPal email the charity entered when inviting (lower-cased).
    paypalEmail: text("paypal_email").notNull(),
    paypalTrackingId: text("paypal_tracking_id").notNull().unique(),
    paypalMerchantId: text("paypal_merchant_id").unique(),
    status: supplierStatus("status").notNull().default("invited"),
    isDemo: boolean("is_demo").notNull().default(false),
    invitedByCharityId: uuid("invited_by_charity_id").references(() => charities.id, { onDelete: "restrict" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    // What PayPal holds for the connected account - the charity typed the name above.
    paypalLegalName: text("paypal_legal_name"),
    paypalCountry: text("paypal_country"),
    // A Proven reviewer checked the business against a listing Proven found itself.
    // Until then its payments go to review instead of passing on their own.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One supplier per PayPal email in each pool: two invites at once can't make two rows.
    unique("suppliers_email_pool").on(t.paypalEmail, t.isDemo),
    check("suppliers_connected_has_merchant", sql`${t.status} <> 'connected' or ${t.paypalMerchantId} is not null`),
  ],
);

/**
 * A charity paying a supplier with PayPal, through Proven: the charity approves
 * on PayPal, the money goes straight from its PayPal to the supplier's. This is
 * the main proof that donors' money bought something real.
 */
export const supplierPaymentStatus = pgEnum("supplier_payment_status", ["created", "completed", "failed", "cancelled", "refunded"]);

export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    status: supplierPaymentStatus("status").notNull().default("created"),
    // The proof row this payment created once it completed.
    proofId: uuid("proof_id").unique(),
    failure: text("failure"),
    // Set (under the need lock) just before Proven asks PayPal to take the money.
    // From then on the payment counts toward the need's cap until it settles.
    captureRequestedAt: timestamp("capture_requested_at", { withTimezone: true }),
    // When the daily job last asked PayPal about this payment (refunds, reversals, stuck captures).
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // The payer (the charity) opened a PayPal dispute: it may get the money back.
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "supplier_payments_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payments_proof_charity_fk", columns: [t.proofId, t.charityId], foreignColumns: [proofs.id, proofs.charityId] }).onDelete("restrict"),
    index("supplier_payments_need_idx").on(t.needId),
    check("supplier_payments_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

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

/**
 * Proven asks a supplier, at the email PayPal confirmed for its account, whether
 * the goods a charity paid for were handed over. One single-use link per
 * supplier payment; only its hash is stored.
 */
export const supplierConfirmationStatus = pgEnum("supplier_confirmation_status", ["requested", "confirmed", "denied"]);

export const supplierConfirmations = pgTable(
  "supplier_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierPaymentId: uuid("supplier_payment_id")
      .notNull()
      .unique()
      .references(() => supplierPayments.id, { onDelete: "restrict" }),
    needId: uuid("need_id").notNull(),
    charityId: uuid("charity_id").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    status: supplierConfirmationStatus("status").notNull().default("requested"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    proofId: uuid("proof_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "supplier_confirmations_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    foreignKey({ name: "supplier_confirmations_proof_charity_fk", columns: [t.proofId, t.charityId], foreignColumns: [proofs.id, proofs.charityId] }).onDelete("restrict"),
  ],
);

/**
 * Post-distribution check: after delivery the charity enters the phone numbers
 * it recorded at intake (with consent); Proven picks a random sample and texts
 * each a one-tap question. One check per need. Phone numbers are never stored:
 * only a keyed fingerprint (to spot the same numbers on other charities' needs)
 * and, for the sampled few, a masked form while their link is open.
 */
export const recipientChecks = pgTable(
  "recipient_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id").notNull().unique(),
    charityId: uuid("charity_id").notNull(),
    proofId: uuid("proof_id").notNull().unique(),
    totalRecipients: integer("total_recipients").notNull(),
    sampleSize: integer("sample_size").notNull(),
    // Numbers also given on another charity's need - shown to reviewers.
    sharedNumbers: integer("shared_numbers").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "recipient_checks_need_charity_fk", columns: [t.needId, t.charityId], foreignColumns: [needs.id, needs.charityId] }).onDelete("restrict"),
    foreignKey({ name: "recipient_checks_proof_charity_fk", columns: [t.proofId, t.charityId], foreignColumns: [proofs.id, proofs.charityId] }).onDelete("restrict"),
    check("recipient_checks_sizes", sql`${t.sampleSize} >= 1 and ${t.sampleSize} <= ${t.totalRecipients}`),
  ],
);

export const recipientAnswer = pgEnum("recipient_answer", ["yes", "no"]);

export const recipientContacts = pgTable(
  "recipient_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => recipientChecks.id, { onDelete: "restrict" }),
    charityId: uuid("charity_id").notNull(),
    // Demo and real charities are separate pools: a demo visitor can never match a real recipient's number.
    isDemo: boolean("is_demo").notNull().default(false),
    // HMAC of the normalised number with a server secret: matches across needs, can't be reversed by guessing.
    phoneKey: text("phone_key").notNull(),
    sampled: boolean("sampled").notNull().default(false),
    tokenHash: text("token_hash").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    answer: recipientAnswer("answer"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("recipient_contacts_check_phone").on(t.checkId, t.phoneKey),
    index("recipient_contacts_phone_idx").on(t.phoneKey),
    check("recipient_contacts_token_if_sampled", sql`${t.sampled} or ${t.tokenHash} is null`),
  ],
);
