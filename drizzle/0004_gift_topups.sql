ALTER TABLE "donations" DROP CONSTRAINT "donations_donor_access_hash_unique";--> statement-breakpoint
CREATE INDEX "donations_donor_access_idx" ON "donations" USING btree ("donor_access_hash");