-- Remove combinations that are invalid under the role-aware subscription model.
DELETE FROM "subscriptions" s
WHERE (s."type" = 'THREAD' AND s."target_user_id" IS NOT NULL)
   OR (s."type" = 'USER' AND s."target_user_id" IS NULL)
   OR s."user_id" = s."target_user_id"
   OR (
     s."type" = 'USER'
     AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = s."target_user_id")
   );

-- Managers receive all activity automatically and must not own redundant subscriptions.
DELETE FROM "subscriptions" s
USING "thread_members" tm
WHERE tm."thread_id" = s."thread_id"
  AND tm."user_id" = s."user_id"
  AND tm."role" IN ('OWNER', 'COLLABORATOR');

-- USER subscriptions are only valid for ordinary players in the same thread.
DELETE FROM "subscriptions" s
WHERE s."type" = 'USER'
  AND NOT EXISTS (
    SELECT 1
    FROM "thread_members" tm
    WHERE tm."thread_id" = s."thread_id"
      AND tm."user_id" = s."target_user_id"
      AND tm."role" = 'PARTICIPANT'
      AND tm."player_marked" = true
  );

-- Private-thread subscriptions require permanent membership of the subscriber.
DELETE FROM "subscriptions" s
USING "threads" t
WHERE t."id" = s."thread_id"
  AND t."visibility" = 'PRIVATE'
  AND NOT EXISTS (
    SELECT 1 FROM "thread_members" tm
    WHERE tm."thread_id" = s."thread_id" AND tm."user_id" = s."user_id"
  );

-- Keep the oldest row before replacing PostgreSQL's NULL-distinct unique index.
DELETE FROM "subscriptions" s
USING (
  SELECT "id"
  FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "user_id", "thread_id", "target_user_id"
      ORDER BY "created_at", "id"
    ) AS row_number
    FROM "subscriptions"
  ) ranked
  WHERE ranked.row_number > 1
) duplicate
WHERE s."id" = duplicate."id";

DROP INDEX "subscriptions_user_id_thread_id_target_user_id_key";
CREATE UNIQUE INDEX "subscriptions_user_id_thread_id_target_user_id_key"
  ON "subscriptions"("user_id", "thread_id", "target_user_id") NULLS NOT DISTINCT;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_type_target_check"
  CHECK (
    ("type" = 'THREAD' AND "target_user_id" IS NULL)
    OR ("type" = 'USER' AND "target_user_id" IS NOT NULL)
  );

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
