ALTER TABLE "posts"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "posts_author_id_client_request_id_key"
  ON "posts"("author_id", "client_request_id");
