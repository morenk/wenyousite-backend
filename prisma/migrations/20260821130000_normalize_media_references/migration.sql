-- Normalize media references that previously existed only as URL strings.
ALTER TABLE "users" ADD COLUMN "avatar_media_id" TEXT;
ALTER TABLE "media" ADD COLUMN "orphaned_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_avatar_media_id_key" ON "users"("avatar_media_id");
CREATE INDEX "media_status_orphaned_at_idx" ON "media"("status", "orphaned_at");

ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_media_id_fkey"
  FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "post_media" (
  "post_id" TEXT NOT NULL,
  "media_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "post_media_pkey" PRIMARY KEY ("post_id", "media_id")
);

CREATE INDEX "post_media_post_id_sort_order_idx" ON "post_media"("post_id", "sort_order");
CREATE INDEX "post_media_media_id_idx" ON "post_media"("media_id");
ALTER TABLE "post_media"
  ADD CONSTRAINT "post_media_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_media"
  ADD CONSTRAINT "post_media_media_id_fkey"
  FOREIGN KEY ("media_id") REFERENCES "media"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "draft_media" (
  "draft_id" TEXT NOT NULL,
  "media_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "draft_media_pkey" PRIMARY KEY ("draft_id", "media_id")
);

CREATE INDEX "draft_media_draft_id_sort_order_idx" ON "draft_media"("draft_id", "sort_order");
CREATE INDEX "draft_media_media_id_idx" ON "draft_media"("media_id");
ALTER TABLE "draft_media"
  ADD CONSTRAINT "draft_media_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_media"
  ADD CONSTRAINT "draft_media_media_id_fkey"
  FOREIGN KEY ("media_id") REFERENCES "media"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
