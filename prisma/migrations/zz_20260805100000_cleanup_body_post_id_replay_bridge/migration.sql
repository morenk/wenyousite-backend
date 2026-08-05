-- The untimestamped add_subthread_body_post migration sorts near the end on a
-- fresh replay and temporarily recreates this retired field. Existing databases
-- skip that applied migration, but both paths must converge on the current schema.

BEGIN;

ALTER TABLE "subthreads"
  DROP CONSTRAINT IF EXISTS "subthreads_body_post_id_fkey";

DROP INDEX IF EXISTS "subthreads_body_post_id_key";

ALTER TABLE "subthreads" DROP COLUMN IF EXISTS "body_post_id";

COMMIT;
