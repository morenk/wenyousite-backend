ALTER TABLE "moment_comments"
  ADD COLUMN "media_id" TEXT,
  ADD COLUMN "sticker_asset_id" TEXT;

CREATE UNIQUE INDEX "moment_comments_media_id_key" ON "moment_comments"("media_id");
CREATE INDEX "moment_comments_sticker_asset_id_idx" ON "moment_comments"("sticker_asset_id");

ALTER TABLE "moment_comments"
  ADD CONSTRAINT "moment_comments_media_id_fkey"
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "moment_comments_sticker_asset_id_fkey"
    FOREIGN KEY ("sticker_asset_id") REFERENCES "sticker_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "moment_comments_single_media_check"
    CHECK ("media_id" IS NULL OR "sticker_asset_id" IS NULL),
  ADD CONSTRAINT "moment_comments_non_empty_check"
    CHECK (length(btrim("content")) > 0 OR "media_id" IS NOT NULL OR "sticker_asset_id" IS NOT NULL);
