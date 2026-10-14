CREATE TYPE "public"."recipient_answer" AS ENUM('yes', 'no');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'recipient_check';--> statement-breakpoint
CREATE TABLE "recipient_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"proof_id" uuid NOT NULL,
	"total_recipients" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"shared_numbers" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_checks_need_id_unique" UNIQUE("need_id"),
	CONSTRAINT "recipient_checks_proof_id_unique" UNIQUE("proof_id"),
	CONSTRAINT "recipient_checks_sizes" CHECK ("recipient_checks"."sample_size" >= 1 and "recipient_checks"."sample_size" <= "recipient_checks"."total_recipients")
);
--> statement-breakpoint
CREATE TABLE "recipient_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"phone_key" text NOT NULL,
	"sampled" boolean DEFAULT false NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"answer" "recipient_answer",
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_contacts_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "recipient_contacts_check_phone" UNIQUE("check_id","phone_key"),
	CONSTRAINT "recipient_contacts_token_if_sampled" CHECK ("recipient_contacts"."sampled" or "recipient_contacts"."token_hash" is null)
);
--> statement-breakpoint
ALTER TABLE "recipient_checks" ADD CONSTRAINT "recipient_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_checks" ADD CONSTRAINT "recipient_checks_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_checks" ADD CONSTRAINT "recipient_checks_proof_charity_fk" FOREIGN KEY ("proof_id","charity_id") REFERENCES "public"."proofs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_contacts" ADD CONSTRAINT "recipient_contacts_check_id_recipient_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."recipient_checks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipient_contacts_phone_idx" ON "recipient_contacts" USING btree ("phone_key");