-- CreateTable
CREATE TABLE "bookmark_folders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_folders_pkey" PRIMARY KEY ("id")
);

-- Every existing account receives one default folder before bookmarks become required to reference it.
INSERT INTO "bookmark_folders" ("id", "user_id", "name", "is_default", "created_at", "updated_at")
SELECT 'c' || substr(md5(random()::text || "id"), 1, 24), "id", '默认收藏夹', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users";

-- AlterTable
ALTER TABLE "user_bookmarks" ADD COLUMN "folder_id" TEXT;

UPDATE "user_bookmarks" AS bookmark
SET "folder_id" = folder."id"
FROM "bookmark_folders" AS folder
WHERE folder."user_id" = bookmark."user_id" AND folder."is_default" = true;

ALTER TABLE "user_bookmarks" ALTER COLUMN "folder_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_folders_user_id_name_key" ON "bookmark_folders"("user_id", "name");
CREATE UNIQUE INDEX "bookmark_folders_one_default_per_user_key" ON "bookmark_folders"("user_id") WHERE "is_default" = true;
CREATE INDEX "bookmark_folders_user_id_created_at_idx" ON "bookmark_folders"("user_id", "created_at");
CREATE INDEX "user_bookmarks_folder_id_created_at_idx" ON "user_bookmarks"("folder_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "bookmark_folders" ADD CONSTRAINT "bookmark_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "bookmark_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
