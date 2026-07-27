/*
  Warnings:

  - You are about to drop the column `visibility` on the `subthreads` table. All the data in the column will be lost.
  - You are about to drop the column `content` on the `threads` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "floor_number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "subthreads" DROP COLUMN "visibility",
ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "posting_policy" SET DEFAULT 'PARTICIPANTS';

-- AlterTable
ALTER TABLE "threads" DROP COLUMN "content",
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "status" SET DEFAULT 'RECRUITING';

-- CreateTable
CREATE TABLE "user_follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_follows_follower_id_following_id_key" ON "user_follows"("follower_id", "following_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "posts_subthread_id_created_at_idx" ON "posts"("subthread_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_thread_id_created_at_idx" ON "posts"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_type_idx" ON "subscriptions"("user_id", "type");

-- AddForeignKey
ALTER TABLE "user_read_progress" ADD CONSTRAINT "user_read_progress_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
