-- The post-like to thread-like refactor was originally applied with db push and
-- never received a migration. Reconcile migration-only databases while keeping
-- databases that already have the current shape unchanged.

BEGIN;

ALTER TABLE "threads"
  ADD COLUMN IF NOT EXISTS "like_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "thread_likes" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "thread_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "thread_likes_thread_id_user_id_key"
  ON "thread_likes"("thread_id", "user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thread_likes_thread_id_fkey'
      AND conrelid = 'thread_likes'::regclass
  ) THEN
    ALTER TABLE "thread_likes"
      ADD CONSTRAINT "thread_likes_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thread_likes_user_id_fkey'
      AND conrelid = 'thread_likes'::regclass
  ) THEN
    ALTER TABLE "thread_likes"
      ADD CONSTRAINT "thread_likes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.post_likes') IS NOT NULL THEN
    INSERT INTO "thread_likes" ("id", "thread_id", "user_id", "created_at")
    SELECT DISTINCT ON (p."thread_id", pl."user_id")
      pl."id", p."thread_id", pl."user_id", pl."created_at"
    FROM "post_likes" pl
    JOIN "posts" p ON p."id" = pl."post_id"
    ORDER BY p."thread_id", pl."user_id", pl."created_at", pl."id"
    ON CONFLICT DO NOTHING;

    UPDATE "threads" t
    SET "like_count" = (
      SELECT count(*)
      FROM "thread_likes" tl
      WHERE tl."thread_id" = t."id"
    );
  END IF;
END $$;

DROP TABLE IF EXISTS "post_likes";
ALTER TABLE "posts" DROP COLUMN IF EXISTS "like_count";

COMMIT;
