CREATE TYPE "public"."supplier_confirmation_status" AS ENUM('requested', 'confirmed', 'denied');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'supplier_confirm_request';--> statement-breakpoint
CREATE TABLE "supplier_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_payment_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "supplier_confirmation_status" DEFAULT 'requested' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"proof_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_confirmations_supplier_payment_id_unique" UNIQUE("supplier_payment_id"),
	CONSTRAINT "supplier_confirmations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "supplier_confirmations_proof_id_unique" UNIQUE("proof_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_confirmations" ADD CONSTRAINT "supplier_confirmations_supplier_payment_id_supplier_payments_id_fk" FOREIGN KEY ("supplier_payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_confirmations" ADD CONSTRAINT "supplier_confirmations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_confirmations" ADD CONSTRAINT "supplier_confirmations_need_charity_fk" FOREIGN KEY ("need_id","charity_id") REFERENCES "public"."needs"("id","charity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_confirmations" ADD CONSTRAINT "supplier_confirmations_proof_charity_fk" FOREIGN KEY ("proof_id","charity_id") REFERENCES "public"."proofs"("id","charity_id") ON DELETE restrict ON UPDATE no action;