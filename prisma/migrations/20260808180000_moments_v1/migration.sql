ALTER TYPE "TipTargetType" ADD VALUE 'MOMENT';
ALTER TYPE "ReportTargetType" ADD VALUE 'MOMENT';
ALTER TYPE "ReportTargetType" ADD VALUE 'MOMENT_COMMENT';
ALTER TYPE "AuditTargetType" ADD VALUE 'MOMENT';
ALTER TYPE "AuditTargetType" ADD VALUE 'MOMENT_COMMENT';

CREATE TYPE "MomentTextCoverTheme" AS ENUM ('ROSE', 'LILAC', 'MINT', 'AMBER');

CREATE TABLE "moments" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "content" VARCHAR(1000) NOT NULL DEFAULT '',
    "text_cover_theme" "MomentTextCoverTheme" NOT NULL DEFAULT 'ROSE',
    "cover_media_id" TEXT,
    "client_request_id" UUID NOT NULL,
    "create_request_hash" TEXT NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "bookmark_count" INTEGER NOT NULL DEFAULT 0,
    "tip_total" BIGINT NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "removal_source" "ContentRemovalSource",
    "removed_by_id" TEXT,
    "removal_reason" TEXT,
    CONSTRAINT "moments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moment_images" (
    "id" TEXT NOT NULL,
    "moment_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "moment_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moment_likes" (
    "id" TEXT NOT NULL,
    "moment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "moment_likes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moment_bookmarks" (
    "id" TEXT NOT NULL,
    "moment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "moment_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moment_comments" (
    "id" TEXT NOT NULL,
    "moment_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "reply_to_comment_id" TEXT,
    "client_request_id" UUID NOT NULL,
    "create_request_hash" TEXT NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "removal_source" "ContentRemovalSource",
    "removed_by_id" TEXT,
    "removal_reason" TEXT,
    CONSTRAINT "moment_comments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notifications" ADD COLUMN "moment_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN "moment_comment_id" TEXT;
ALTER TABLE "wallet_transactions" ADD COLUMN "target_moment_id" TEXT;
ALTER TABLE "wallet_transactions" ADD COLUMN "moment_tip_total_after" BIGINT;

CREATE UNIQUE INDEX "moments_author_id_client_request_id_key" ON "moments"("author_id", "client_request_id");
CREATE INDEX "moments_public_created_idx" ON "moments"("deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "moments_author_created_idx" ON "moments"("author_id", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "moments_title_trgm_idx" ON "moments" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "moments_content_trgm_idx" ON "moments" USING GIN ("content" gin_trgm_ops);

CREATE UNIQUE INDEX "moment_images_media_id_key" ON "moment_images"("media_id");
CREATE UNIQUE INDEX "moment_images_moment_id_sort_order_key" ON "moment_images"("moment_id", "sort_order");
CREATE INDEX "moment_images_moment_id_idx" ON "moment_images"("moment_id");

CREATE UNIQUE INDEX "moment_likes_moment_id_user_id_key" ON "moment_likes"("moment_id", "user_id");
CREATE INDEX "moment_likes_user_id_created_at_idx" ON "moment_likes"("user_id", "created_at" DESC);

CREATE UNIQUE INDEX "moment_bookmarks_moment_id_user_id_key" ON "moment_bookmarks"("moment_id", "user_id");
CREATE INDEX "moment_bookmarks_user_id_created_at_idx" ON "moment_bookmarks"("user_id", "created_at" DESC);

CREATE UNIQUE INDEX "moment_comments_author_id_client_request_id_key" ON "moment_comments"("author_id", "client_request_id");
CREATE INDEX "moment_comments_roots_idx" ON "moment_comments"("moment_id", "parent_comment_id", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "moment_comments_replies_idx" ON "moment_comments"("parent_comment_id", "created_at", "id");
CREATE INDEX "wallet_transactions_target_moment_id_created_at_idx" ON "wallet_transactions"("target_moment_id", "created_at");

ALTER TABLE "moments" ADD CONSTRAINT "moments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moments" ADD CONSTRAINT "moments_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moment_images" ADD CONSTRAINT "moment_images_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_images" ADD CONSTRAINT "moment_images_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moment_likes" ADD CONSTRAINT "moment_likes_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_likes" ADD CONSTRAINT "moment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_bookmarks" ADD CONSTRAINT "moment_bookmarks_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_bookmarks" ADD CONSTRAINT "moment_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_comments" ADD CONSTRAINT "moment_comments_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_comments" ADD CONSTRAINT "moment_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moment_comments" ADD CONSTRAINT "moment_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "moment_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moment_comments" ADD CONSTRAINT "moment_comments_reply_to_comment_id_fkey" FOREIGN KEY ("reply_to_comment_id") REFERENCES "moment_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_moment_comment_id_fkey" FOREIGN KEY ("moment_comment_id") REFERENCES "moment_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_target_moment_id_fkey" FOREIGN KEY ("target_moment_id") REFERENCES "moments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
