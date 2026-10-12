ALTER TABLE "donations" ADD COLUMN "donor_access_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_access_hash_unique" UNIQUE("donor_access_hash");