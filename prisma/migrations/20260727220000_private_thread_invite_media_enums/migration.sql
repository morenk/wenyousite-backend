-- CreateEnum
CREATE TYPE "ThreadVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "NotificationType" AS ENUM ('reply', 'mention', 'new_floor', 'thread_created', 'follow');
CREATE TYPE "SubscriptionType" AS ENUM ('THREAD', 'USER');

-- AlterTable threads
ALTER TABLE "threads" ADD COLUMN "visibility" "ThreadVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable subscriptions
ALTER TABLE "subscriptions" DROP COLUMN "type",
ADD COLUMN "type" "SubscriptionType" NOT NULL DEFAULT 'THREAD';

-- AlterTable notifications
ALTER TABLE "notifications" DROP COLUMN "type",
ADD COLUMN "type" "NotificationType" NOT NULL;

-- CreateTable thread_invites
CREATE TABLE "thread_invites" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "thread_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "thread_invites_token_key" ON "thread_invites"("token");
CREATE UNIQUE INDEX "thread_invites_thread_id_key" ON "thread_invites"("thread_id");
ALTER TABLE "thread_invites" ADD CONSTRAINT "thread_invites_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable media
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
