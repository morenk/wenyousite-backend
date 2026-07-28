-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable: add status column, default to COMPLETED for existing records
ALTER TABLE "media" ADD COLUMN "status" "MediaStatus" NOT NULL DEFAULT 'COMPLETED';

-- CreateIndex: enforce unique key
CREATE UNIQUE INDEX "media_key_key" ON "media"("key");
