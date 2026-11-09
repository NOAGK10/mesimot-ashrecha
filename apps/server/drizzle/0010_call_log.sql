CREATE TYPE "public"."call_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('answered', 'missed', 'approved', 'disconnected', 'callback', 'done');--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"caller_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"person_id" uuid,
	"direction" "call_direction" DEFAULT 'in' NOT NULL,
	"status" "call_status" NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_owner_idx" ON "calls" USING btree ("owner_person_id","occurred_at");