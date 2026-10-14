CREATE TYPE "public"."proof_status" AS ENUM('checking', 'passed', 'needs_review', 'failed');--> statement-breakpoint
CREATE TABLE "proof_files" (
	"proof_id" uuid PRIMARY KEY NOT NULL,
	"charity_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_files_size" CHECK ("proof_files"."size_bytes" > 0 and "proof_files"."size_bytes" <= 6000000),
	CONSTRAINT "proof_files_mime" CHECK ("proof_files"."mime" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
CREATE TABLE "proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"kind" "proof_type" NOT NULL,
	"status" "proof_status" DEFAULT 'checking' NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai" jsonb,
	"ai_model" text,
	"amount_cents" integer,
	"image_sha256" text,
	"fingerprint" text,
	"duplicate_of" uuid,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proofs_id_charity" UNIQUE("id","charity_id"),
	CONSTRAINT "proofs_amount_positive" CHECK ("proofs"."amount_cents" is null or "proofs"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "proof_files" ADD CONSTRAINT "proof_files_proof_charity_fk" FOREIGN KEY ("proof_id","charity_id") REFERENCES "public"."proofs"("id","charity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proofs_need_idx" ON "proofs" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "proofs_image_idx" ON "proofs" USING btree ("image_sha256");--> statement-breakpoint
CREATE INDEX "proofs_fingerprint_idx" ON "proofs" USING btree ("fingerprint");