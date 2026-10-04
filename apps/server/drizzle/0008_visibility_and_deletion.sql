CREATE TYPE "public"."task_visibility" AS ENUM('org', 'private');--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "visibility" "task_visibility" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;