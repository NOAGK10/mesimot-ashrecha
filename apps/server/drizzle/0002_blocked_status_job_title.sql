ALTER TYPE "public"."task_status" ADD VALUE 'blocked' BEFORE 'completed';--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "job_title" text;