/*
  Warnings:

  - You are about to drop the column `token_version` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `registration_drafts` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "email_verifications" ADD COLUMN     "email" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL,
ALTER COLUMN "type" SET DEFAULT 'REGISTRATION';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "token_version";

-- DropTable
DROP TABLE "registration_drafts";

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "device_info" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verifications_email_type_idx" ON "email_verifications"("email", "type");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
