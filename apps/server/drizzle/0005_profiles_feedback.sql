ALTER TYPE "public"."inbox_kind" ADD VALUE 'feedback';--> statement-breakpoint
CREATE TABLE "person_avatars" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "feedback_id" bigint;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "avatar_color" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "responsibilities" text;--> statement-breakpoint
ALTER TABLE "person_avatars" ADD CONSTRAINT "person_avatars_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_feedback" ADD CONSTRAINT "person_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_feedback" ADD CONSTRAINT "person_feedback_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_feedback" ADD CONSTRAINT "person_feedback_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_feedback" ADD CONSTRAINT "person_feedback_deleted_by_person_id_people_id_fk" FOREIGN KEY ("deleted_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_feedback_subject_idx" ON "person_feedback" USING btree ("subject_person_id","id");--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_feedback_id_person_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."person_feedback"("id") ON DELETE cascade ON UPDATE no action;