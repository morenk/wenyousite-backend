-- 提及来源用于区分单人提及与 @全体玩家快照，通知事件键用于队列重试幂等。
CREATE TYPE "MentionSource" AS ENUM ('DIRECT', 'ALL_PLAYERS');

ALTER TABLE "post_mentions"
  ADD COLUMN "source" "MentionSource" NOT NULL DEFAULT 'DIRECT';

DROP INDEX "post_mentions_post_id_mentioned_user_id_key";
CREATE UNIQUE INDEX "post_mentions_post_id_mentioned_user_id_source_key"
  ON "post_mentions"("post_id", "mentioned_user_id", "source");

ALTER TABLE "notifications" ADD COLUMN "event_key" TEXT;
UPDATE "notifications" SET "event_key" = "id" WHERE "event_key" IS NULL;
ALTER TABLE "notifications" ALTER COLUMN "event_key" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "event_key" SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "notifications_user_id_event_key_key"
  ON "notifications"("user_id", "event_key");
