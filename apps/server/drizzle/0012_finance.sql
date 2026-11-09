CREATE TYPE "public"."finance_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "finance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "finance_kind" NOT NULL,
	"amount_agorot" bigint NOT NULL,
	"description" text NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"reported_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	CONSTRAINT "finance_amount_positive" CHECK ("finance_entries"."amount_agorot" > 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "finance_opening_agorot" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_reported_by_person_id_people_id_fk" FOREIGN KEY ("reported_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_deleted_by_person_id_people_id_fk" FOREIGN KEY ("deleted_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_entries_org_idx" ON "finance_entries" USING btree ("org_id","occurred_on");