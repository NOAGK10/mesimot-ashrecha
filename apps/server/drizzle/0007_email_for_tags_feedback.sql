ALTER TYPE "public"."notification_kind" ADD VALUE 'mention';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'feedback';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_id" bigint;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "feedback_id" bigint;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_feedback_id_person_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."person_feedback"("id") ON DELETE cascade ON UPDATE no action;