CREATE TABLE "proof_fingerprints" (
	"proof_id" uuid NOT NULL,
	"key" text NOT NULL,
	"is_demo" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_fingerprints_proof_id_key_pk" PRIMARY KEY("proof_id","key")
);
--> statement-breakpoint
ALTER TABLE "proof_fingerprints" ADD CONSTRAINT "proof_fingerprints_proof_id_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."proofs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_fingerprints_key_idx" ON "proof_fingerprints" USING btree ("key","is_demo");