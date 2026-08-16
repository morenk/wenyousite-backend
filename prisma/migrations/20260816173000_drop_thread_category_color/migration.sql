UPDATE "audit_logs"
SET "metadata" = ("metadata" - 'color')
  || CASE
    WHEN jsonb_typeof("metadata" -> 'previous') = 'object'
      THEN jsonb_build_object('previous', ("metadata" -> 'previous') - 'color')
    ELSE '{}'::jsonb
  END
  || CASE
    WHEN jsonb_typeof("metadata" -> 'current') = 'object'
      THEN jsonb_build_object('current', ("metadata" -> 'current') - 'color')
    ELSE '{}'::jsonb
  END
WHERE "target_type" = 'THREAD_CATEGORY'
  AND jsonb_typeof("metadata") = 'object';

ALTER TABLE "thread_category_definitions" DROP COLUMN "color";
