ALTER TABLE "posts"
  ADD COLUMN "pinned_at" TIMESTAMP(3);

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_pinned_shape_check"
  CHECK (
    "pinned_at" IS NULL
    OR ("kind" = 'FLOOR' AND "parent_post_id" IS NULL)
  );

CREATE INDEX "posts_subthread_pinned_active_idx"
  ON "posts"("subthread_id", "pinned_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "pinned_at" IS NOT NULL;
