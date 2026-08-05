-- The earlier migration looked up the constraint name globally. PostgreSQL allows
-- the same constraint name in different schemas, so isolated or tenant schemas
-- could incorrectly skip this invariant when public already had the constraint.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'refresh_tokens_platform_check'
      AND conrelid = 'refresh_tokens'::regclass
  ) THEN
    ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "refresh_tokens_platform_check"
      CHECK ("platform" IN ('web', 'mobile'));
  END IF;
END $$;

COMMIT;
