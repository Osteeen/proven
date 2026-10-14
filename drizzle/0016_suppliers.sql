CREATE TYPE "public"."supplier_payment_status" AS ENUM('created', 'completed', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('invited', 'connected');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'supplier_invite';--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"status" "supplier_payment_status" DEFAULT 'created' NOT NULL,
	"proof_id" uuid,
	"failure" text,
	"created_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "supplier_payments_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "supplier_payments_proof_id_unique" UNIQUE("proof_id"),
	CONSTRAINT "supplier_payments_amount_positive" CHECK ("supplier_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"paypal_email" text NOT NULL,
	"paypal_tracking_id" text NOT NULL,
	"paypal_merchant_id" text,
	"status" "supplier_status" DEFAULT 'invited' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"invited_by_charity_id" uuid,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_paypal_tracking_id_unique" UNIQUE("paypal_tracking_id"),
	CONSTRAINT "suppliers_paypal_merchant_id_unique" UNIQUE("paypal_merchant_id"),
	CONSTRAINT "suppliers_connected_has_merchant" CHECK ("suppliers"."status" <> 'connected' or "suppliers"."paypal_merchant_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "charity_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_proof_charity_fk" FOREIGN KEY ("proof_id","charity_id") REFERENCES "public"."proofs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_invited_by_charity_id_charities_id_fk" FOREIGN KEY ("invited_by_charity_id") REFERENCES "public"."charities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_payments_need_idx" ON "supplier_payments" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "suppliers_email_idx" ON "suppliers" USING btree ("paypal_email");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE restrict ON UPDATE no action;