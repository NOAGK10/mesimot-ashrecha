CREATE TABLE "sheet_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"responsible" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_sheet_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_sheet_by" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_sync_error" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_unmatched" jsonb;--> statement-breakpoint
ALTER TABLE "sheet_contacts" ADD CONSTRAINT "sheet_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_contacts_org_idx" ON "sheet_contacts" USING btree ("org_id","position");