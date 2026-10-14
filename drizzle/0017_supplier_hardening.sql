DROP INDEX "suppliers_email_idx";--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "capture_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_pool" UNIQUE("paypal_email","is_demo");