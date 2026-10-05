-- 资料引用仅追加；保留现有身份、发言快照与媒体引用。
ALTER TABLE "thread_identities" ADD COLUMN "profile_post_id" TEXT,
  ADD COLUMN "author_version" INTEGER NOT NULL DEFAULT 1;
-- 保持部署前已签发的作者确认 token；资料更新不再改变作者版本。
UPDATE "thread_identities" SET "author_version" = "version";
CREATE INDEX "thread_identities_profile_post_id_idx" ON "thread_identities"("profile_post_id");
ALTER TABLE "thread_identities" ADD CONSTRAINT "thread_identities_profile_post_id_fkey"
  FOREIGN KEY ("profile_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
