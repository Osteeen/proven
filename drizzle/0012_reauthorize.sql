ALTER TABLE "donations" ADD COLUMN "capture_authorization_id" text;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "reauthorize_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_capture_authorization_id_unique" UNIQUE("capture_authorization_id");