ALTER TABLE "posts" ADD COLUMN "gallery_indexed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "posts" ADD COLUMN "gallery_content_updated_at" TIMESTAMP(3);
CREATE TABLE "post_image_occurrences" ("post_id" TEXT NOT NULL, "image_index" INTEGER NOT NULL, "image_count" INTEGER NOT NULL, "url" TEXT NOT NULL, CONSTRAINT "post_image_occurrences_pkey" PRIMARY KEY ("post_id", "image_index"), CONSTRAINT "post_image_occurrences_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "posts_gallery_unindexed_idx" ON "posts" ("id") WHERE "gallery_indexed" = false;
