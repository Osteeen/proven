ALTER TABLE "charities" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "donor_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_id_donation" UNIQUE("id","donation_id");--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_id_need" UNIQUE("id","need_id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_capture_donation_fk" FOREIGN KEY ("capture_id","donation_id") REFERENCES "public"."captures"("id","donation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_donation_need_fk" FOREIGN KEY ("donation_id","need_id") REFERENCES "public"."donations"("id","need_id") ON DELETE restrict ON UPDATE no action;
