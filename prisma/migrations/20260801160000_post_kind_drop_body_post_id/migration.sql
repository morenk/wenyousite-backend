-- PostKind 枚举 + kind 列；正文与楼层用显式角色区分，移除 Subthread.bodyPostId

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('BODY', 'FLOOR');

-- AlterTable
ALTER TABLE "posts" ADD COLUMN "kind" "PostKind" NOT NULL DEFAULT 'FLOOR';

-- Backfill: 现有子贴正文（subthreads.body_post_id 指向的帖子）标记为 BODY
UPDATE "posts" p
SET "kind" = 'BODY'
FROM "subthreads" s
WHERE s."body_post_id" = p."id";

-- CreateIndex
CREATE INDEX "posts_subthread_id_kind_idx" ON "posts"("subthread_id", "kind");

-- DropForeignKey
ALTER TABLE "subthreads" DROP CONSTRAINT "subthreads_body_post_id_fkey";

-- DropIndex
DROP INDEX "subthreads_body_post_id_key";

-- DropColumn
ALTER TABLE "subthreads" DROP COLUMN "body_post_id";
