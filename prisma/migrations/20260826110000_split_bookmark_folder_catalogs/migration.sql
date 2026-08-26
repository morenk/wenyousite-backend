-- Dynamic bookmarks now use an independent folder catalog. Existing rows keep
-- the same folder IDs so clients deployed before the split remain compatible.
CREATE TABLE "moment_bookmark_folders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moment_bookmark_folders_pkey" PRIMARY KEY ("id")
);

INSERT INTO "moment_bookmark_folders" (
    "id", "user_id", "name", "is_default", "created_at", "updated_at"
)
SELECT
    "id", "user_id", "name", "is_default", "created_at", "updated_at"
FROM "bookmark_folders";

-- Defensive repair for accounts created outside the normal registration path.
INSERT INTO "moment_bookmark_folders" (
    "id", "user_id", "name", "is_default", "created_at", "updated_at"
)
SELECT
    'c' || substr(md5('moment-default:' || users."id"), 1, 24),
    users."id",
    '默认收藏夹',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users" AS users
WHERE NOT EXISTS (
    SELECT 1
    FROM "moment_bookmark_folders" AS folder
    WHERE folder."user_id" = users."id" AND folder."is_default" = true
);

CREATE UNIQUE INDEX "moment_bookmark_folders_user_id_name_key"
ON "moment_bookmark_folders"("user_id", "name");

CREATE UNIQUE INDEX "moment_bookmark_folders_one_default_per_user_key"
ON "moment_bookmark_folders"("user_id") WHERE "is_default" = true;

CREATE INDEX "moment_bookmark_folders_user_id_created_at_idx"
ON "moment_bookmark_folders"("user_id", "created_at");

ALTER TABLE "moment_bookmark_folders"
ADD CONSTRAINT "moment_bookmark_folders_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "moment_bookmarks"
DROP CONSTRAINT "moment_bookmarks_folder_id_fkey";

ALTER TABLE "moment_bookmarks"
ADD CONSTRAINT "moment_bookmarks_folder_id_fkey"
FOREIGN KEY ("folder_id") REFERENCES "moment_bookmark_folders"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
