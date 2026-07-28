/*
  Warnings:

  - The `posting_policy` column on the `subthreads` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `role` column on the `thread_members` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `role` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'COLLABORATOR', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "PostingPolicy" AS ENUM ('PARTICIPANTS', 'COLLABORATORS', 'PLAYERS');

-- AlterTable
ALTER TABLE "subthreads" DROP COLUMN "posting_policy",
ADD COLUMN     "posting_policy" "PostingPolicy" NOT NULL DEFAULT 'PARTICIPANTS';

-- AlterTable
ALTER TABLE "thread_members" DROP COLUMN "role",
ADD COLUMN     "role" "MemberRole" NOT NULL DEFAULT 'PARTICIPANT';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "email_verifications_token_idx" ON "email_verifications"("token");
