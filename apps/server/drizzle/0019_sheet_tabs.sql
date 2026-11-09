ALTER TABLE "organizations" ADD COLUMN "institutions_sheet_gid" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contacts_sheet_gid" text;--> statement-breakpoint
ALTER TABLE "sheet_sources" ADD COLUMN "gid" text;