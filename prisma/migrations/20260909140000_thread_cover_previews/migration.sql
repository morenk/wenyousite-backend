-- 列表预览不替代原图；历史媒体不回填。失败尝试保留精确 key 与可重试墓碑。
ALTER TABLE "media" ADD COLUMN "preview_variants" JSONB;
CREATE TYPE "MediaPreviewAttemptStatus" AS ENUM ('PENDING', 'PUBLISHED', 'CLEANING');
CREATE TABLE "media_preview_attempts" (
  "id" TEXT NOT NULL,
  "media_id" TEXT NOT NULL,
  "keys" TEXT[] NOT NULL,
  "status" "MediaPreviewAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "next_cleanup_at" TIMESTAMP(3) NOT NULL,
  "cleanup_passes" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_preview_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_preview_attempts_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "media_preview_attempts_status_next_cleanup_at_idx" ON "media_preview_attempts"("status", "next_cleanup_at");
CREATE INDEX "media_preview_attempts_media_id_idx" ON "media_preview_attempts"("media_id");
