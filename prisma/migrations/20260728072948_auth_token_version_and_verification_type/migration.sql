-- AlterTable
ALTER TABLE "email_verifications" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'EMAIL_VERIFY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "email_verifications_user_id_type_idx" ON "email_verifications"("user_id", "type");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_type_idx" ON "subscriptions"("user_id", "type");
