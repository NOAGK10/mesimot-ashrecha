CREATE TYPE "public"."document_kind" AS ENUM('google_doc', 'google_sheet', 'link');--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"google_file_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"category_id" uuid,
	"added_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_documents" (
	"task_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"added_by_person_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_documents_task_id_document_id_pk" PRIMARY KEY("task_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "task_import_rows" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"source_row" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_name" text NOT NULL,
	"sheet_name" text DEFAULT '' NOT NULL,
	"document_id" uuid,
	"approved_by_person_id" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_added_by_person_id_people_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_added_by_person_id_people_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_import_rows" ADD CONSTRAINT "task_import_rows_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_import_rows" ADD CONSTRAINT "task_import_rows_import_id_task_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."task_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_imports" ADD CONSTRAINT "task_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_imports" ADD CONSTRAINT "task_imports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_imports" ADD CONSTRAINT "task_imports_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_org_name_uq" ON "document_categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_google_uq" ON "documents" USING btree ("org_id","google_file_id");--> statement-breakpoint
CREATE INDEX "task_documents_document_idx" ON "task_documents" USING btree ("document_id");