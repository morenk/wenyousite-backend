-- Keep the original sign-in time stable while refresh tokens rotate within a terminal session.
BEGIN;

ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_started_at" TIMESTAMP(3);

UPDATE "refresh_tokens" AS token
SET "session_started_at" = family_start."started_at"
FROM (
  SELECT "user_id", "family", MIN("created_at") AS "started_at"
  FROM "refresh_tokens"
  GROUP BY "user_id", "family"
) AS family_start
WHERE token."user_id" = family_start."user_id"
  AND token."family" = family_start."family";

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "session_started_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "session_started_at" SET NOT NULL;

-- Access-token guards resolve the stable terminal family on every authenticated request.
CREATE INDEX "refresh_tokens_user_id_family_revoked_at_idx"
  ON "refresh_tokens"("user_id", "family", "revoked_at");

COMMIT;
