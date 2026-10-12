CREATE TYPE "public"."message_kind" AS ENUM('gift_held', 'gift_added');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "message_kind" NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text,
	"donation_id" uuid,
	"transport" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "donor_email" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at");