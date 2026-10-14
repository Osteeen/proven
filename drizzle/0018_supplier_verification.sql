ALTER TYPE "public"."supplier_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "paypal_legal_name" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "paypal_country" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;