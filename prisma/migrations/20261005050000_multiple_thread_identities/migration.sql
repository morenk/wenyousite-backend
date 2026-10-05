-- 现有身份保持稳定 ID，并成为旧单身份接口的明确兼容锚点。
ALTER TABLE "thread_identities" ADD COLUMN "compatibility_identity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3);
UPDATE "thread_identities" SET "compatibility_identity" = true;
DROP INDEX "thread_identities_thread_id_user_id_key";
CREATE UNIQUE INDEX "thread_identities_active_compatibility_key" ON "thread_identities" ("thread_id", "user_id")
  WHERE "compatibility_identity" = true AND "deleted_at" IS NULL;
CREATE INDEX "thread_identities_thread_id_user_id_deleted_at_idx" ON "thread_identities" ("thread_id", "user_id", "deleted_at");
ALTER TABLE "posts" ADD COLUMN "identity_request_hash" VARCHAR(64);
ALTER TABLE "subthreads" ADD COLUMN "identity_request_hash" VARCHAR(64);
