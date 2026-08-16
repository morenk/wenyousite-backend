ALTER TABLE "email_verifications"
ADD COLUMN "last_send_attempt_at" TIMESTAMP(3),
ADD COLUMN "last_sent_at" TIMESTAMP(3);
