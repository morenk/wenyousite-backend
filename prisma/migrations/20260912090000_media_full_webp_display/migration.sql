-- 来源 URL/对象键与既有 MediaStatus 保留；历史补处理不影响当前引用。
ALTER TABLE "media" ADD COLUMN "display_asset" JSONB,
  ADD COLUMN "display_status" TEXT,
  ADD COLUMN "display_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "display_started_at" TIMESTAMP(3),
  ADD COLUMN "display_failure_code" TEXT;
ALTER TABLE "media" ADD CONSTRAINT "media_display_status_check"
  CHECK ("display_status" IS NULL OR "display_status" IN ('PROCESSING', 'READY', 'FAILED'));
ALTER TABLE "sticker_assets" ADD COLUMN "display_asset" JSONB;
