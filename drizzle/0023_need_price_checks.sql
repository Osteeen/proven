CREATE TYPE "public"."price_verdict" AS ENUM('in_line', 'above', 'well_above', 'below', 'unknown');--> statement-breakpoint
CREATE TABLE "need_price_checks" (
	"need_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"item" text,
	"quantity" integer,
	"unit_cents" integer,
	"market_median_cents" integer,
	"market_low_cents" integer,
	"market_high_cents" integer,
	"comparable_count" integer DEFAULT 0 NOT NULL,
	"verdict" "price_verdict" DEFAULT 'unknown' NOT NULL,
	"listings" jsonb,
	"attempts" integer DEFAULT 1 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "need_price_checks" ADD CONSTRAINT "need_price_checks_need_id_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."needs"("id") ON DELETE restrict ON UPDATE no action;