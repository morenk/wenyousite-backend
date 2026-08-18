-- Ensure every existing account has a default folder before dynamic bookmarks reference one.
UPDATE "bookmark_folders" AS folder
SET "is_default" = true
WHERE folder."name" = '默认收藏夹'
  AND NOT EXISTS (
    SELECT 1
    FROM "bookmark_folders" AS existing
    WHERE existing."user_id" = folder."user_id" AND existing."is_default" = true
  );

INSERT INTO "bookmark_folders" (
  "id", "user_id", "name", "is_default", "created_at", "updated_at"
)
SELECT
  'c' || substr(md5(random()::text || users."id"), 1, 24),
  users."id",
  '默认收藏夹',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" AS users
WHERE NOT EXISTS (
  SELECT 1
  FROM "bookmark_folders" AS folder
  WHERE folder."user_id" = users."id" AND folder."is_default" = true
);

ALTER TABLE "moment_bookmarks" ADD COLUMN "folder_id" TEXT;

UPDATE "moment_bookmarks" AS bookmark
SET "folder_id" = folder."id"
FROM "bookmark_folders" AS folder
WHERE folder."user_id" = bookmark."user_id" AND folder."is_default" = true;

ALTER TABLE "moment_bookmarks" ALTER COLUMN "folder_id" SET NOT NULL;

CREATE INDEX "moment_bookmarks_folder_id_created_at_idx"
ON "moment_bookmarks"("folder_id", "created_at" DESC);

ALTER TABLE "moment_bookmarks"
ADD CONSTRAINT "moment_bookmarks_folder_id_fkey"
FOREIGN KEY ("folder_id") REFERENCES "bookmark_folders"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
