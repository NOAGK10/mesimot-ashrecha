CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "institutions_sheet_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "institutions_sheet_by" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "institutions_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "institutions_sync_error" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "institutions_unmatched" jsonb;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "institutions_org_idx" ON "institutions" USING btree ("org_id","position");