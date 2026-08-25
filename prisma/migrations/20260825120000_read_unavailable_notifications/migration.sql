-- Unavailable targets remain as history, but must never retain an unread badge.
UPDATE "notifications" AS n
SET "is_read" = true
WHERE n."is_read" = false
  AND (
    (
      n."thread_id" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "threads" AS t
        WHERE t."id" = n."thread_id"
          AND (
            t."deleted_at" IS NOT NULL
            OR (t."published" = false AND t."owner_id" <> n."user_id")
            OR (
              t."published" = true
              AND t."visibility" = 'PRIVATE'
              AND NOT EXISTS (
                SELECT 1
                FROM "thread_members" AS tm
                WHERE tm."thread_id" = t."id"
                  AND tm."user_id" = n."user_id"
              )
            )
          )
      )
    )
    OR (
      n."post_id" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "posts" AS p
        INNER JOIN "threads" AS t ON t."id" = p."thread_id"
        INNER JOIN "subthreads" AS s ON s."id" = p."subthread_id"
        LEFT JOIN "posts" AS parent ON parent."id" = p."parent_post_id"
        WHERE p."id" = n."post_id"
          AND (
            p."deleted_at" IS NOT NULL
            OR t."deleted_at" IS NOT NULL
            OR s."deleted_at" IS NOT NULL
            OR parent."deleted_at" IS NOT NULL
            OR (t."published" = false AND t."owner_id" <> n."user_id")
            OR (
              t."published" = true
              AND t."visibility" = 'PRIVATE'
              AND NOT EXISTS (
                SELECT 1
                FROM "thread_members" AS tm
                WHERE tm."thread_id" = t."id"
                  AND tm."user_id" = n."user_id"
              )
            )
          )
      )
    )
    OR (
      n."moment_id" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "moments" AS m
        WHERE m."id" = n."moment_id"
          AND m."deleted_at" IS NOT NULL
      )
    )
    OR (
      n."moment_comment_id" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "moment_comments" AS mc
        LEFT JOIN "moment_comments" AS parent ON parent."id" = mc."parent_comment_id"
        WHERE mc."id" = n."moment_comment_id"
          AND (
            mc."deleted_at" IS NOT NULL
            OR (parent."deleted_at" IS NOT NULL AND parent."removal_source" = 'ADMIN')
          )
      )
    )
    OR (
      n."thread_id" IS NULL
      AND n."post_id" IS NULL
      AND n."moment_id" IS NULL
      AND n."type"::text IN (
        'reply',
        'mention',
        'new_floor',
        'subthread_created',
        'new_post',
        'thread_created',
        'like'
      )
    )
    OR (
      n."thread_id" IS NULL
      AND n."post_id" IS NULL
      AND n."moment_id" IS NULL
      AND n."type"::text IN ('follow', 'tip')
      AND n."from_user_id" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "users" AS u
        WHERE u."id" = n."from_user_id"
          AND u."deleted_at" IS NOT NULL
      )
    )
  );
