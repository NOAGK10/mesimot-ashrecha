CREATE TYPE "public"."campaign_section" AS ENUM('video', 'song', 'plan', 'file');--> statement-breakpoint
CREATE TYPE "public"."campaign_source" AS ENUM('upload', 'drive', 'link');--> statement-breakpoint
CREATE TABLE "campaign_files" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"data_base64" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"section" "campaign_section" NOT NULL,
	"source" "campaign_source" NOT NULL,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"url" text,
	"drive_file_id" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" bigint,
	"added_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_files" ADD CONSTRAINT "campaign_files_item_id_campaign_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."campaign_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_items" ADD CONSTRAINT "campaign_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_items" ADD CONSTRAINT "campaign_items_added_by_person_id_people_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_items_campaign_idx" ON "campaign_items" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "campaigns_org_idx" ON "campaigns" USING btree ("org_id","created_at");