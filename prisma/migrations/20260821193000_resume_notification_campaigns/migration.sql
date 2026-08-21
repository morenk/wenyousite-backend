ALTER TABLE "system_notification_campaigns"
ADD COLUMN "dispatch_cursor" TEXT,
ADD COLUMN "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_attempt_at" TIMESTAMP(3);

CREATE INDEX "system_notification_campaigns_status_last_attempt_at_idx"
ON "system_notification_campaigns"("status", "last_attempt_at");
