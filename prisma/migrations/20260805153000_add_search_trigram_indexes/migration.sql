-- Accelerate case-insensitive substring search for usernames, thread titles,
-- and post content. Very short post queries are still rejected by the API.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_username_trgm_idx"
  ON "users" USING GIN ("username" gin_trgm_ops);

CREATE INDEX "threads_title_trgm_idx"
  ON "threads" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "posts_content_trgm_idx"
  ON "posts" USING GIN ("content" gin_trgm_ops);

COMMIT;
