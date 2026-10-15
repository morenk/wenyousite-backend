ALTER TYPE "MediaPurpose" ADD VALUE 'RICH_CONTENT_AUDIO';
ALTER TABLE "media" ADD COLUMN "duration_ms" INTEGER, ADD COLUMN "failure_code" TEXT;
ALTER TABLE "media" ADD CONSTRAINT "media_duration_ms_positive" CHECK ("duration_ms" IS NULL OR "duration_ms" > 0);
