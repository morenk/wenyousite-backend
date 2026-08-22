ALTER TABLE "media"
ADD COLUMN "processing_started_at" TIMESTAMP(3);

UPDATE "media"
SET "processing_started_at" = "created_at"
WHERE "status" = 'PROCESSING';

CREATE INDEX "media_status_processing_started_at_idx"
ON "media"("status", "processing_started_at");
