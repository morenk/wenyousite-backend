-- DropIndex
DROP INDEX "drafts_user_id_subthread_id_slot_key";

-- AlterTable drafts
ALTER TABLE "drafts" DROP COLUMN "subthread_id",
DROP COLUMN "thread_id";

-- CreateIndex
CREATE UNIQUE INDEX "drafts_user_id_slot_key" ON "drafts"("user_id", "slot");

-- AlterTable threads
ALTER TABLE "threads" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable posts
ALTER TABLE "posts" ADD COLUMN "like_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable post_likes
CREATE TABLE "post_likes" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_post_id_user_id_key" ON "post_likes"("post_id", "user_id");

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
