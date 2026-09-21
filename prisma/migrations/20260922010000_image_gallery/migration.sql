CREATE TABLE "post_gallery_indexes" (
  "post_id" TEXT NOT NULL PRIMARY KEY,
  "content_transaction" BIGINT NOT NULL,
  CONSTRAINT "post_gallery_indexes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "post_image_occurrences" (
  "post_id" TEXT NOT NULL,
  "image_index" INTEGER NOT NULL,
  "image_count" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  CONSTRAINT "post_image_occurrences_pkey" PRIMARY KEY ("post_id", "image_index"),
  CONSTRAINT "post_image_occurrences_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
