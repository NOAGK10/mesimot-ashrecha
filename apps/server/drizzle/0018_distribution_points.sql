CREATE TABLE "distribution_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_sources" (
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sheet_id" text NOT NULL,
	"by_person_id" uuid,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"unmatched" jsonb,
	CONSTRAINT "sheet_sources_org_id_kind_pk" PRIMARY KEY("org_id","kind")
);
--> statement-breakpoint
ALTER TABLE "distribution_points" ADD CONSTRAINT "distribution_points_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distribution_points_org_idx" ON "distribution_points" USING btree ("org_id","position");