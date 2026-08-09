-- Fail with a useful error instead of partially hardening inconsistent data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "subthreads"
    WHERE "deleted_at" IS NULL
    GROUP BY "thread_id", "sort_order"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot harden subthreads: duplicate active sort_order values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "posts"
    WHERE "kind" = 'BODY' AND "deleted_at" IS NULL
    GROUP BY "subthread_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot harden posts: multiple active BODY posts exist in one subthread';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "posts" p
    JOIN "subthreads" s ON s."id" = p."subthread_id"
    WHERE p."thread_id" <> s."thread_id"
  ) THEN
    RAISE EXCEPTION 'cannot harden posts: thread_id does not match the referenced subthread';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "threads" t
    JOIN "subthreads" s ON s."id" = t."default_subthread_id"
    WHERE t."id" <> s."thread_id"
  ) THEN
    RAISE EXCEPTION 'cannot harden threads: default subthread belongs to another thread';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "posts" child
    JOIN "posts" parent ON parent."id" = child."parent_post_id"
    WHERE child."subthread_id" <> parent."subthread_id"
  ) THEN
    RAISE EXCEPTION 'cannot harden posts: parent post belongs to another subthread';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "posts" child
    JOIN "posts" replied ON replied."id" = child."reply_to_post_id"
    WHERE child."subthread_id" <> replied."subthread_id"
  ) THEN
    RAISE EXCEPTION 'cannot harden posts: reply target belongs to another subthread';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "posts"
    WHERE NOT (
      (
        "kind" = 'BODY'
        AND "floor_number" IS NULL
        AND "parent_post_id" IS NULL
        AND "reply_to_post_id" IS NULL
      )
      OR
      (
        "kind" = 'FLOOR'
        AND (
          (
            "parent_post_id" IS NULL
            AND "floor_number" IS NOT NULL
            AND "floor_number" > 0
          )
          OR
          (
            "parent_post_id" IS NOT NULL
            AND "floor_number" IS NULL
          )
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'cannot harden posts: invalid BODY/FLOOR shape exists';
  END IF;
END $$;

-- Soft-deleted subthreads no longer reserve their former display position.
ALTER TABLE "subthreads"
  DROP CONSTRAINT "subthreads_thread_id_sort_order_key";

CREATE UNIQUE INDEX "subthreads_thread_id_sort_order_active_key"
  ON "subthreads"("thread_id", "sort_order")
  WHERE "deleted_at" IS NULL;

-- Composite candidate keys support same-aggregate foreign keys below.
ALTER TABLE "subthreads"
  ADD CONSTRAINT "subthreads_thread_id_id_key"
    UNIQUE ("thread_id", "id");

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_id_subthread_id_key"
    UNIQUE ("id", "subthread_id");

-- A subthread has at most one live body. A historical soft-deleted body does
-- not prevent recovery by creating a replacement.
CREATE UNIQUE INDEX "posts_subthread_id_active_body_key"
  ON "posts"("subthread_id")
  WHERE "kind" = 'BODY' AND "deleted_at" IS NULL;

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_kind_shape_check"
    CHECK (
      (
        "kind" = 'BODY'
        AND "floor_number" IS NULL
        AND "parent_post_id" IS NULL
        AND "reply_to_post_id" IS NULL
      )
      OR
      (
        "kind" = 'FLOOR'
        AND (
          (
            "parent_post_id" IS NULL
            AND "floor_number" IS NOT NULL
            AND "floor_number" > 0
          )
          OR
          (
            "parent_post_id" IS NOT NULL
            AND "floor_number" IS NULL
          )
        )
      )
    );

-- Denormalized identifiers must still point into the same thread/subthread.
ALTER TABLE "posts"
  ADD CONSTRAINT "posts_thread_id_subthread_id_same_thread_fkey"
    FOREIGN KEY ("thread_id", "subthread_id")
    REFERENCES "subthreads"("thread_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_id_default_subthread_id_same_thread_fkey"
    FOREIGN KEY ("id", "default_subthread_id")
    REFERENCES "subthreads"("thread_id", "id")
    ON DELETE SET NULL ("default_subthread_id") ON UPDATE CASCADE;

-- A hard-deleted root floor must take its nested replies with it. SET NULL
-- would turn those rows into invalid root floors without a floor number.
ALTER TABLE "posts"
  DROP CONSTRAINT "posts_parent_post_id_fkey";

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_parent_post_id_fkey"
    FOREIGN KEY ("parent_post_id")
    REFERENCES "posts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_parent_post_id_same_subthread_fkey"
    FOREIGN KEY ("parent_post_id", "subthread_id")
    REFERENCES "posts"("id", "subthread_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_reply_to_post_id_same_subthread_fkey"
    FOREIGN KEY ("reply_to_post_id", "subthread_id")
    REFERENCES "posts"("id", "subthread_id")
    ON DELETE SET NULL ("reply_to_post_id") ON UPDATE CASCADE;
