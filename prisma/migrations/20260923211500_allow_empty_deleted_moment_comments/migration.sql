ALTER TABLE "moment_comments"
  ADD CONSTRAINT "moment_comments_non_empty_or_deleted_check"
    CHECK (
      "deleted_at" IS NOT NULL
      OR length(btrim("content")) > 0
      OR "media_id" IS NOT NULL
      OR "sticker_asset_id" IS NOT NULL
    ) NOT VALID;

ALTER TABLE "moment_comments"
  VALIDATE CONSTRAINT "moment_comments_non_empty_or_deleted_check";

ALTER TABLE "moment_comments"
  DROP CONSTRAINT "moment_comments_non_empty_check";

ALTER TABLE "moment_comments"
  RENAME CONSTRAINT "moment_comments_non_empty_or_deleted_check"
  TO "moment_comments_non_empty_check";
