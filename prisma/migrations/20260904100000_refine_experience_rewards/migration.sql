ALTER TYPE "ExperienceEventType" ADD VALUE 'MOMENT_PUBLISHED';
ALTER TYPE "ExperienceEventType" ADD VALUE 'PRIVATE_THREAD_ACTIVATED';
ALTER TYPE "ExperienceEventType" ADD VALUE 'THREAD_REPLY_RECEIVED';
ALTER TYPE "ExperienceEventType" ADD VALUE 'MOMENT_COMMENT_CREATED';
ALTER TYPE "ExperienceEventType" ADD VALUE 'MOMENT_REPLY_RECEIVED';
ALTER TYPE "ExperienceEventType" ADD VALUE 'TIP_SENT';
ALTER TYPE "ExperienceEventType" ADD VALUE 'TIP_RECEIVED';

ALTER TABLE "experience_daily_stats"
  ADD COLUMN "moment_publish_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "received_reply_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "moment_comment_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "moment_reply_received_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tip_sent_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tip_received_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "experience_daily_stats"
  DROP CONSTRAINT "experience_daily_stats_nonnegative_check",
  ADD CONSTRAINT "experience_daily_stats_nonnegative_check" CHECK (
    "check_in_count" >= 0
    AND "thread_publish_count" >= 0
    AND "post_create_count" >= 0
    AND "received_reply_count" >= 0
    AND "received_like_count" >= 0
    AND "moment_publish_count" >= 0
    AND "moment_comment_count" >= 0
    AND "moment_reply_received_count" >= 0
    AND "tip_sent_count" >= 0
    AND "tip_received_count" >= 0
    AND "experience_awarded" >= 0
  );

ALTER TABLE "daily_check_ins"
  DROP CONSTRAINT "daily_check_ins_reward_check",
  ADD CONSTRAINT "daily_check_ins_reward_check" CHECK (
    "reward_amount" BETWEEN 1 AND 3
    AND "experience_awarded" IN (0, 2)
  );
