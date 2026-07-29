-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'new_post';
ALTER TYPE "NotificationType" ADD VALUE 'like';
ALTER TYPE "NotificationType" ADD VALUE 'system';

-- AlterTable
ALTER TABLE "media" ALTER COLUMN "status" SET DEFAULT 'UPLOADING';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "threads" ALTER COLUMN "published_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "last_username_change" SET DATA TYPE TIMESTAMP(3);
