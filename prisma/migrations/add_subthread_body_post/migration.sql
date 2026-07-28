-- AddSubthreadBodyPost
ALTER TABLE "subthreads" ADD COLUMN "body_post_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subthreads_body_post_id_key" ON "subthreads"("body_post_id");

-- AddForeignKey
ALTER TABLE "subthreads" ADD CONSTRAINT "subthreads_body_post_id_fkey" FOREIGN KEY ("body_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for each subthread, find the first non-deleted floor post and set as body
UPDATE "subthreads" s
SET "body_post_id" = (
  SELECT p."id"
  FROM "posts" p
  WHERE p."subthread_id" = s."id"
    AND p."deleted_at" IS NULL
    AND p."floor_number" = 1
    AND p."parent_post_id" IS NULL
  ORDER BY p."created_at" ASC
  LIMIT 1
)
WHERE s."body_post_id" IS NULL;
