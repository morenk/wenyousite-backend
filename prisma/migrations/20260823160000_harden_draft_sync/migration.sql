-- Fail before changing the schema when historical rows violate the five-slot
-- and optimistic-lock invariants expected by every client.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "drafts" WHERE "slot" NOT BETWEEN 1 AND 5) THEN
    RAISE EXCEPTION 'cannot harden drafts: slot outside 1..5 exists'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM "drafts" WHERE "version" < 1) THEN
    RAISE EXCEPTION 'cannot harden drafts: version below 1 exists'
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE "drafts"
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "create_request_hash" TEXT,
  ADD CONSTRAINT "drafts_slot_range_check" CHECK ("slot" BETWEEN 1 AND 5),
  ADD CONSTRAINT "drafts_version_positive_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "drafts_create_idempotency_pair_check" CHECK (
    ("client_request_id" IS NULL AND "create_request_hash" IS NULL)
    OR
    ("client_request_id" IS NOT NULL AND "create_request_hash" IS NOT NULL)
  );

CREATE UNIQUE INDEX "drafts_user_id_client_request_id_key"
  ON "drafts"("user_id", "client_request_id");
