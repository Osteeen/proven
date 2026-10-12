CREATE TYPE "public"."refund_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'gift_refunded';--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"donation_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"paypal_refund_id" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "refunds_paypal_refund_id_unique" UNIQUE("paypal_refund_id"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_capture_charity_fk" FOREIGN KEY ("capture_id","charity_id") REFERENCES "public"."captures"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_donation_charity_fk" FOREIGN KEY ("donation_id","charity_id") REFERENCES "public"."donations"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_need_idx" ON "refunds" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "refunds_batch_idx" ON "refunds" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_refund_within_amount" CHECK ("captures"."refunded_cents" >= 0 and "captures"."refunded_cents" <= "captures"."amount_cents");--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_refund_within_charged" CHECK ("donations"."refunded_cents" >= 0 and "donations"."refunded_cents" <= "donations"."captured_cents");