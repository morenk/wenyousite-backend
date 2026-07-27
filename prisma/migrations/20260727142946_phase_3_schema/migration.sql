-- DropForeignKey
ALTER TABLE "subthread_tags" DROP CONSTRAINT "subthread_tags_tag_id_fkey";

-- DropForeignKey
ALTER TABLE "tags" DROP CONSTRAINT "tags_thread_id_fkey";

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "subthread_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "subthreads" ALTER COLUMN "posting_policy" SET DEFAULT 'COLLABORATORS';

-- AlterTable
ALTER TABLE "thread_members" ADD COLUMN     "player_marked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'DEDUCTION';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_bookmarks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_player_badges" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_recent_replies" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "tags";

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subthread_tag_defs" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subthread_tag_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_topic_tags" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "thread_topic_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'THREAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "subthread_tag_defs_thread_id_name_key" ON "subthread_tag_defs"("thread_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "topic_tags_name_key" ON "topic_tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "thread_topic_tags_thread_id_tag_id_key" ON "thread_topic_tags"("thread_id", "tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_thread_id_target_user_id_key" ON "subscriptions"("user_id", "thread_id", "target_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_user_id_subthread_id_slot_key" ON "drafts"("user_id", "subthread_id", "slot");

-- AddForeignKey
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subthread_tag_defs" ADD CONSTRAINT "subthread_tag_defs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subthread_tags" ADD CONSTRAINT "subthread_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "subthread_tag_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_topic_tags" ADD CONSTRAINT "thread_topic_tags_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_topic_tags" ADD CONSTRAINT "thread_topic_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "topic_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

