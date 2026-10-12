CREATE TYPE "public"."release_kind" AS ENUM('advance', 'final');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('pending_review', 'approved', 'executing', 'completed', 'failed', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'gift_proven';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'gift_released';--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"kind" "release_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "release_status" NOT NULL,
	"review_reason" text,
	"note" text,
	"requested_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_id_charity" UNIQUE("id","charity_id"),
	CONSTRAINT "releases_amount_non_negative" CHECK ("releases"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"verified" boolean NOT NULL,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "release_id" uuid;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "releases_status_idx" ON "releases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_one_active_per_need" ON "releases" USING btree ("need_id") WHERE "releases"."status" in ('pending_review', 'approved', 'executing');--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_release_charity_fk" FOREIGN KEY ("release_id","charity_id") REFERENCES "public"."releases"("id","charity_id") ON DELETE restrict ON UPDATE no action;