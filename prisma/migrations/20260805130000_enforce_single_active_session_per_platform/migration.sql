-- Normalize legacy and client-supplied platform values before enforcing the two-slot policy.
UPDATE "refresh_tokens"
SET "platform" = CASE WHEN "platform" = 'mobile' THEN 'mobile' ELSE 'web' END
WHERE "platform" IS NULL OR "platform" NOT IN ('web', 'mobile');

-- Expired tokens are not active sessions and must not occupy a platform slot.
UPDATE "refresh_tokens"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "revoked_at" IS NULL AND "expires_at" <= CURRENT_TIMESTAMP;

-- Keep the newest live session for each user/platform pair and revoke older duplicates.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "platform"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "position"
  FROM "refresh_tokens"
  WHERE "revoked_at" IS NULL
)
UPDATE "refresh_tokens" AS token
SET "revoked_at" = CURRENT_TIMESTAMP
FROM ranked
WHERE token."id" = ranked."id" AND ranked."position" > 1;

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "platform" SET DEFAULT 'web',
  ALTER COLUMN "platform" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refresh_tokens_platform_check'
  ) THEN
    ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "refresh_tokens_platform_check"
      CHECK ("platform" IN ('web', 'mobile'));
  END IF;
END $$;

-- Database-level invariant: at most one non-revoked refresh token per user/platform.
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_user_id_platform_active_key"
  ON "refresh_tokens" ("user_id", "platform")
  WHERE "revoked_at" IS NULL;
