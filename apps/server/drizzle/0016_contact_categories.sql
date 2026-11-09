CREATE TABLE "contact_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_category_members" (
	"category_id" uuid NOT NULL,
	"contact_key" text NOT NULL,
	CONSTRAINT "contact_category_members_category_id_contact_key_pk" PRIMARY KEY("category_id","contact_key")
);
--> statement-breakpoint
ALTER TABLE "contact_categories" ADD CONSTRAINT "contact_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_category_members" ADD CONSTRAINT "contact_category_members_category_id_contact_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contact_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_categories_org_name_uq" ON "contact_categories" USING btree ("org_id","name");