-- Replay bridge for the legacy add_subthread_body_post migration.
-- That migration has no timestamp prefix, so a fresh database sorts it after
-- 20260801160000_post_kind_drop_body_post_id. Restore the old shape before the
-- contract migration without modifying checksums of already-applied history.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '20260801160000_post_kind_drop_body_post_id'
      AND "finished_at" IS NOT NULL
      AND "rolled_back_at" IS NULL
  ) THEN
    ALTER TABLE "subthreads" ADD COLUMN IF NOT EXISTS "body_post_id" TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS "subthreads_body_post_id_key"
      ON "subthreads"("body_post_id");

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'subthreads_body_post_id_fkey'
        AND conrelid = 'subthreads'::regclass
    ) THEN
      ALTER TABLE "subthreads"
        ADD CONSTRAINT "subthreads_body_post_id_fkey"
        FOREIGN KEY ("body_post_id") REFERENCES "posts"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

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
  END IF;
END $$;

COMMIT;
