ALTER TYPE "NotificationType" ADD VALUE 'tip';
ALTER TYPE "NotificationType" ADD VALUE 'level_up';

CREATE TYPE "WalletKind" AS ENUM ('USER', 'PLATFORM');
CREATE TYPE "WalletTransactionType" AS ENUM ('DAILY_CHECK_IN', 'TIP');
CREATE TYPE "TipTargetType" AS ENUM ('THREAD', 'USER');
CREATE TYPE "ExperienceEventType" AS ENUM (
  'DAILY_CHECK_IN',
  'THREAD_PUBLISHED',
  'POST_CREATED',
  'THREAD_LIKED',
  'REVERSAL'
);

ALTER TABLE "users"
  ADD COLUMN "experience" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "threads"
  ADD COLUMN "tip_total" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD CONSTRAINT "users_experience_nonnegative_check" CHECK ("experience" >= 0),
  ADD CONSTRAINT "users_level_range_check" CHECK ("level" BETWEEN 1 AND 9);

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_tip_total_nonnegative_check" CHECK ("tip_total" >= 0);

CREATE TABLE "wallets" (
  "id" TEXT NOT NULL,
  "kind" "WalletKind" NOT NULL,
  "user_id" TEXT,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "received_tip_total" BIGINT NOT NULL DEFAULT 0,
  "received_tip_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallets_nonnegative_check" CHECK (
    "balance" >= 0 AND "received_tip_total" >= 0 AND "received_tip_count" >= 0
  ),
  CONSTRAINT "wallets_owner_kind_check" CHECK (
    ("kind" = 'USER' AND "user_id" IS NOT NULL)
    OR ("kind" = 'PLATFORM' AND "user_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");
CREATE INDEX "wallets_kind_idx" ON "wallets"("kind");
CREATE UNIQUE INDEX "wallets_single_platform_idx"
  ON "wallets"("kind") WHERE "kind" = 'PLATFORM';

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "wallets" (
  "id", "kind", "user_id", "balance", "received_tip_total", "received_tip_count"
)
SELECT
  'wallet_user_' || "id", 'USER', "id", 0, 0, 0
FROM "users";

INSERT INTO "wallets" (
  "id", "kind", "user_id", "balance", "received_tip_total", "received_tip_count"
) VALUES ('wallet_platform', 'PLATFORM', NULL, 0, 0, 0);

CREATE TABLE "wallet_transactions" (
  "id" TEXT NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "sender_wallet_id" TEXT,
  "recipient_wallet_id" TEXT NOT NULL,
  "platform_wallet_id" TEXT,
  "target_type" "TipTargetType",
  "target_thread_id" TEXT,
  "target_user_id" TEXT,
  "gross_amount" BIGINT NOT NULL,
  "recipient_amount" BIGINT NOT NULL,
  "platform_amount" BIGINT NOT NULL DEFAULT 0,
  "sender_balance_after" BIGINT,
  "recipient_balance_after" BIGINT NOT NULL,
  "platform_balance_after" BIGINT,
  "thread_tip_total_after" BIGINT,
  "recipient_tip_total_after" BIGINT NOT NULL DEFAULT 0,
  "recipient_tip_count_after" INTEGER NOT NULL DEFAULT 0,
  "client_request_id" UUID,
  "request_hash" TEXT,
  "date_key" VARCHAR(10),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_transactions_amounts_check" CHECK (
    "gross_amount" > 0
    AND "recipient_amount" >= 0
    AND "platform_amount" >= 0
    AND "recipient_amount" + "platform_amount" = "gross_amount"
  ),
  CONSTRAINT "wallet_transactions_tip_shape_check" CHECK (
    "type" <> 'TIP'
    OR (
      "sender_wallet_id" IS NOT NULL
      AND "platform_wallet_id" IS NOT NULL
      AND "target_type" IS NOT NULL
      AND "target_user_id" IS NOT NULL
      AND "client_request_id" IS NOT NULL
      AND "request_hash" IS NOT NULL
      AND "gross_amount" >= 2
    )
  )
);

CREATE UNIQUE INDEX "wallet_transactions_sender_wallet_id_client_request_id_key"
  ON "wallet_transactions"("sender_wallet_id", "client_request_id");
CREATE INDEX "wallet_transactions_sender_wallet_id_created_at_id_idx"
  ON "wallet_transactions"("sender_wallet_id", "created_at" DESC, "id" DESC);
CREATE INDEX "wallet_transactions_recipient_wallet_id_created_at_id_idx"
  ON "wallet_transactions"("recipient_wallet_id", "created_at" DESC, "id" DESC);
CREATE INDEX "wallet_transactions_target_thread_id_created_at_idx"
  ON "wallet_transactions"("target_thread_id", "created_at");

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_sender_wallet_id_fkey"
    FOREIGN KEY ("sender_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_recipient_wallet_id_fkey"
    FOREIGN KEY ("recipient_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_platform_wallet_id_fkey"
    FOREIGN KEY ("platform_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_target_thread_id_fkey"
    FOREIGN KEY ("target_thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_target_user_id_fkey"
    FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "daily_check_ins" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "wallet_id" TEXT NOT NULL,
  "wallet_transaction_id" TEXT NOT NULL,
  "date_key" VARCHAR(10) NOT NULL,
  "reward_amount" BIGINT NOT NULL,
  "experience_awarded" INTEGER NOT NULL DEFAULT 2,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_check_ins_reward_check" CHECK (
    "reward_amount" BETWEEN 1 AND 3 AND "experience_awarded" = 2
  )
);

CREATE UNIQUE INDEX "daily_check_ins_wallet_transaction_id_key"
  ON "daily_check_ins"("wallet_transaction_id");
CREATE UNIQUE INDEX "daily_check_ins_user_id_date_key_key"
  ON "daily_check_ins"("user_id", "date_key");
CREATE INDEX "daily_check_ins_wallet_id_created_at_idx"
  ON "daily_check_ins"("wallet_id", "created_at" DESC);

ALTER TABLE "daily_check_ins"
  ADD CONSTRAINT "daily_check_ins_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "daily_check_ins_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "daily_check_ins_wallet_transaction_id_fkey"
    FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "experience_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "ExperienceEventType" NOT NULL,
  "delta" INTEGER NOT NULL,
  "date_key" VARCHAR(10) NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" TEXT,
  "note" TEXT,
  "reversed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experience_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_events_delta_check" CHECK ("delta" <> 0)
);

CREATE UNIQUE INDEX "experience_events_idempotency_key_key"
  ON "experience_events"("idempotency_key");
CREATE INDEX "experience_events_user_id_created_at_id_idx"
  ON "experience_events"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "experience_events_source_type_source_id_idx"
  ON "experience_events"("source_type", "source_id");

ALTER TABLE "experience_events"
  ADD CONSTRAINT "experience_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "experience_daily_stats" (
  "user_id" TEXT NOT NULL,
  "date_key" VARCHAR(10) NOT NULL,
  "check_in_count" INTEGER NOT NULL DEFAULT 0,
  "thread_publish_count" INTEGER NOT NULL DEFAULT 0,
  "post_create_count" INTEGER NOT NULL DEFAULT 0,
  "received_like_count" INTEGER NOT NULL DEFAULT 0,
  "experience_awarded" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experience_daily_stats_pkey" PRIMARY KEY ("user_id", "date_key"),
  CONSTRAINT "experience_daily_stats_nonnegative_check" CHECK (
    "check_in_count" >= 0
    AND "thread_publish_count" >= 0
    AND "post_create_count" >= 0
    AND "received_like_count" >= 0
    AND "experience_awarded" >= 0
  )
);

ALTER TABLE "experience_daily_stats"
  ADD CONSTRAINT "experience_daily_stats_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
