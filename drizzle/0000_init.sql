CREATE TYPE "public"."actor_type" AS ENUM('system', 'reviewer', 'charity', 'donor', 'paypal_webhook');--> statement-breakpoint
CREATE TYPE "public"."capture_reason" AS ENUM('booking_confirmed', 'delivery_proven');--> statement-breakpoint
CREATE TYPE "public"."capture_status" AS ENUM('pending', 'completed', 'declined', 'failed');--> statement-breakpoint
CREATE TYPE "public"."charity_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('pending_approval', 'authorized', 'partially_captured', 'captured', 'voided', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."funding_model" AS ENUM('reimbursement', 'staged');--> statement-breakpoint
CREATE TYPE "public"."ledger_event" AS ENUM('authorized', 'reauthorized', 'capture_requested', 'captured', 'capture_failed', 'voided', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."need_status" AS ENUM('draft', 'open', 'funded', 'delivering', 'in_review', 'proven', 'not_proven', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."proof_type" AS ENUM('receipt', 'supplier_confirmation', 'recipient_confirmation', 'live_photo', 'supplier_paypal_payment');--> statement-breakpoint
CREATE TYPE "public"."trust_tier" AS ENUM('new', 'established', 'trusted');--> statement-breakpoint
CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" "capture_reason" NOT NULL,
	"final_capture" boolean DEFAULT false NOT NULL,
	"request_id" uuid NOT NULL,
	"paypal_capture_id" text,
	"status" "capture_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "captures_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "captures_id_charity" UNIQUE("id","charity_id"),
	CONSTRAINT "captures_amount_positive" CHECK ("captures"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "charities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"paypal_tracking_id" text NOT NULL,
	"paypal_merchant_id" text,
	"payments_receivable" boolean DEFAULT false NOT NULL,
	"status" charity_status DEFAULT 'pending' NOT NULL,
	"trust_tier" "trust_tier" DEFAULT 'new' NOT NULL,
	"per_need_limit_cents" integer DEFAULT 50000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charities_paypal_tracking_id_unique" UNIQUE("paypal_tracking_id"),
	CONSTRAINT "charities_paypal_merchant_id_unique" UNIQUE("paypal_merchant_id"),
	CONSTRAINT "charities_per_need_limit_positive" CHECK ("charities"."per_need_limit_cents" > 0),
	CONSTRAINT "charities_active_needs_merchant" CHECK ("charities"."status" <> 'active' or "charities"."paypal_merchant_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"create_request_id" uuid NOT NULL,
	"paypal_order_id" text,
	"paypal_authorization_id" text,
	"paypal_payer_id" text,
	"authorized_at" timestamp with time zone,
	"honor_period_ends_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"status" "donation_status" DEFAULT 'pending_approval' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_create_request_id_unique" UNIQUE("create_request_id"),
	CONSTRAINT "donations_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "donations_paypal_authorization_id_unique" UNIQUE("paypal_authorization_id"),
	CONSTRAINT "donations_id_charity" UNIQUE("id","charity_id"),
	CONSTRAINT "donations_amount_positive" CHECK ("donations"."amount_cents" > 0),
	CONSTRAINT "donations_captured_within_hold" CHECK ("donations"."captured_cents" >= 0 and "donations"."captured_cents" <= "donations"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charity_id" uuid NOT NULL,
	"donation_id" uuid,
	"capture_id" uuid,
	"event" "ledger_event" NOT NULL,
	"amount_cents" integer NOT NULL,
	"paypal_reference" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_amount_non_negative" CHECK ("ledger_entries"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"funding_model" "funding_model" DEFAULT 'reimbursement' NOT NULL,
	"required_proof" "proof_type"[] NOT NULL,
	"status" "need_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "needs_id_charity" UNIQUE("id","charity_id"),
	CONSTRAINT "needs_amount_positive" CHECK ("needs"."amount_cents" > 0),
	CONSTRAINT "needs_currency_usd" CHECK ("needs"."currency" = 'USD'),
	CONSTRAINT "needs_deadline_window" CHECK ("needs"."deadline" > "needs"."created_at" and "needs"."deadline" <= "needs"."created_at" + interval '28 days'),
	CONSTRAINT "needs_two_proofs" CHECK (cardinality("needs"."required_proof") >= 2)
);
--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_donation_charity_fk" FOREIGN KEY ("donation_id","charity_id") REFERENCES "public"."donations"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_donation_charity_fk" FOREIGN KEY ("donation_id","charity_id") REFERENCES "public"."donations"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_capture_charity_fk" FOREIGN KEY ("capture_id","charity_id") REFERENCES "public"."captures"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "needs" ADD CONSTRAINT "needs_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captures_donation_idx" ON "captures" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "donations_charity_idx" ON "donations" USING btree ("charity_id");--> statement-breakpoint
CREATE INDEX "donations_need_idx" ON "donations" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "donations_hold_expiry_idx" ON "donations" USING btree ("hold_expires_at");--> statement-breakpoint
CREATE INDEX "ledger_charity_created_idx" ON "ledger_entries" USING btree ("charity_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_donation_idx" ON "ledger_entries" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "needs_charity_status_idx" ON "needs" USING btree ("charity_id","status");