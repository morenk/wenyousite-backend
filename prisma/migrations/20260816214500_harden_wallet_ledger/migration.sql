-- 温油账本只允许追加。类型字段由 CHECK 固定，同一签到在事务提交时与签到事实交叉校验。

ALTER TABLE "wallet_transactions"
  DROP CONSTRAINT "wallet_transactions_tip_shape_check",
  ADD CONSTRAINT "wallet_transactions_snapshot_nonnegative_check" CHECK (
    "recipient_balance_after" >= 0
    AND "recipient_tip_total_after" >= 0
    AND "recipient_tip_count_after" >= 0
    AND ("sender_balance_after" IS NULL OR "sender_balance_after" >= 0)
    AND ("platform_balance_after" IS NULL OR "platform_balance_after" >= 0)
    AND ("thread_tip_total_after" IS NULL OR "thread_tip_total_after" >= 0)
    AND ("moment_tip_total_after" IS NULL OR "moment_tip_total_after" >= 0)
  ),
  ADD CONSTRAINT "wallet_transactions_type_shape_check" CHECK (
    (
      "type" = 'DAILY_CHECK_IN'
      AND "sender_wallet_id" IS NULL
      AND "platform_wallet_id" IS NULL
      AND "target_type" IS NULL
      AND "target_thread_id" IS NULL
      AND "target_user_id" IS NULL
      AND "target_moment_id" IS NULL
      AND "gross_amount" BETWEEN 1 AND 3
      AND "recipient_amount" = "gross_amount"
      AND "platform_amount" = 0
      AND "sender_balance_after" IS NULL
      AND "platform_balance_after" IS NULL
      AND "thread_tip_total_after" IS NULL
      AND "moment_tip_total_after" IS NULL
      AND "client_request_id" IS NULL
      AND "request_hash" IS NULL
      AND "date_key" IS NOT NULL
    )
    OR
    (
      "type" = 'TIP'
      AND "sender_wallet_id" IS NOT NULL
      AND "platform_wallet_id" IS NOT NULL
      AND "sender_wallet_id" <> "recipient_wallet_id"
      AND "sender_wallet_id" <> "platform_wallet_id"
      AND "recipient_wallet_id" <> "platform_wallet_id"
      AND "target_type" IS NOT NULL
      AND "target_user_id" IS NOT NULL
      AND "gross_amount" >= 2
      AND "sender_balance_after" IS NOT NULL
      AND "platform_balance_after" IS NOT NULL
      AND "client_request_id" IS NOT NULL
      AND "request_hash" IS NOT NULL
      AND "date_key" IS NULL
      AND (
        (
          "target_type" = 'THREAD'
          AND "target_thread_id" IS NOT NULL
          AND "target_moment_id" IS NULL
          AND "thread_tip_total_after" IS NOT NULL
          AND "moment_tip_total_after" IS NULL
        )
        OR
        (
          "target_type" = 'USER'
          AND "target_thread_id" IS NULL
          AND "target_moment_id" IS NULL
          AND "thread_tip_total_after" IS NULL
          AND "moment_tip_total_after" IS NULL
        )
        OR
        (
          "target_type" = 'MOMENT'
          AND "target_thread_id" IS NULL
          AND "target_moment_id" IS NOT NULL
          AND "thread_tip_total_after" IS NULL
          AND "moment_tip_total_after" IS NOT NULL
        )
      )
    )
  );

-- 账本不可变后，历史目标必须随账本保留；软删除仍不受影响。
ALTER TABLE "wallet_transactions"
  DROP CONSTRAINT "wallet_transactions_target_thread_id_fkey",
  DROP CONSTRAINT "wallet_transactions_target_user_id_fkey",
  DROP CONSTRAINT "wallet_transactions_target_moment_id_fkey",
  ADD CONSTRAINT "wallet_transactions_target_thread_id_fkey"
    FOREIGN KEY ("target_thread_id") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_target_user_id_fkey"
    FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallet_transactions_target_moment_id_fkey"
    FOREIGN KEY ("target_moment_id") REFERENCES "moments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_check_ins"
  DROP CONSTRAINT "daily_check_ins_user_id_fkey",
  ADD CONSTRAINT "daily_check_ins_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 在开启触发器前验证历史跨表关系；异常时整条 migration 回滚。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "wallet_transactions" transaction
    JOIN "wallets" recipient_wallet ON recipient_wallet."id" = transaction."recipient_wallet_id"
    LEFT JOIN "daily_check_ins" check_in
      ON check_in."wallet_transaction_id" = transaction."id"
    WHERE transaction."type" = 'DAILY_CHECK_IN'
      AND (
        recipient_wallet."kind" <> 'USER'
        OR recipient_wallet."user_id" IS NULL
        OR check_in."id" IS NULL
        OR check_in."user_id" IS DISTINCT FROM recipient_wallet."user_id"
        OR check_in."wallet_id" IS DISTINCT FROM transaction."recipient_wallet_id"
        OR check_in."date_key" IS DISTINCT FROM transaction."date_key"
        OR check_in."reward_amount" IS DISTINCT FROM transaction."gross_amount"
      )
  ) THEN
    RAISE EXCEPTION 'existing daily check-in ledger rows are inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "daily_check_ins" check_in
    JOIN "wallet_transactions" transaction
      ON transaction."id" = check_in."wallet_transaction_id"
    JOIN "wallets" wallet ON wallet."id" = check_in."wallet_id"
    WHERE transaction."type" <> 'DAILY_CHECK_IN'
      OR wallet."kind" <> 'USER'
      OR wallet."user_id" IS DISTINCT FROM check_in."user_id"
      OR transaction."recipient_wallet_id" IS DISTINCT FROM check_in."wallet_id"
      OR transaction."date_key" IS DISTINCT FROM check_in."date_key"
      OR transaction."gross_amount" IS DISTINCT FROM check_in."reward_amount"
      OR transaction."recipient_amount" IS DISTINCT FROM check_in."reward_amount"
      OR transaction."platform_amount" <> 0
  ) THEN
    RAISE EXCEPTION 'existing daily check-in facts are inconsistent with the ledger'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "wallet_transactions" transaction
    JOIN "wallets" sender_wallet ON sender_wallet."id" = transaction."sender_wallet_id"
    JOIN "wallets" recipient_wallet ON recipient_wallet."id" = transaction."recipient_wallet_id"
    JOIN "wallets" platform_wallet ON platform_wallet."id" = transaction."platform_wallet_id"
    LEFT JOIN "threads" thread ON thread."id" = transaction."target_thread_id"
    LEFT JOIN "moments" moment ON moment."id" = transaction."target_moment_id"
    WHERE transaction."type" = 'TIP'
      AND (
        sender_wallet."kind" <> 'USER'
        OR sender_wallet."user_id" IS NULL
        OR recipient_wallet."kind" <> 'USER'
        OR recipient_wallet."user_id" IS NULL
        OR platform_wallet."kind" <> 'PLATFORM'
        OR platform_wallet."user_id" IS NOT NULL
        OR transaction."target_user_id" IS DISTINCT FROM recipient_wallet."user_id"
        OR (transaction."target_type" = 'THREAD' AND thread."owner_id" IS DISTINCT FROM recipient_wallet."user_id")
        OR (transaction."target_type" = 'MOMENT' AND moment."author_id" IS DISTINCT FROM recipient_wallet."user_id")
      )
  ) THEN
    RAISE EXCEPTION 'existing tip ledger relations are inconsistent'
      USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE FUNCTION "reject_wallet_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END
$$;

CREATE FUNCTION "validate_wallet_transaction_relations"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sender_kind "WalletKind";
  sender_user_id TEXT;
  recipient_kind "WalletKind";
  recipient_user_id TEXT;
  platform_kind "WalletKind";
  platform_user_id TEXT;
BEGIN
  SELECT "kind", "user_id"
  INTO recipient_kind, recipient_user_id
  FROM "wallets"
  WHERE "id" = NEW."recipient_wallet_id";

  IF recipient_kind IS DISTINCT FROM 'USER' OR recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'wallet transaction recipient must be a user wallet'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."type" = 'DAILY_CHECK_IN' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "daily_check_ins" check_in
      WHERE check_in."wallet_transaction_id" = NEW."id"
        AND check_in."user_id" = recipient_user_id
        AND check_in."wallet_id" = NEW."recipient_wallet_id"
        AND check_in."date_key" = NEW."date_key"
        AND check_in."reward_amount" = NEW."gross_amount"
    ) THEN
      RAISE EXCEPTION 'daily check-in transaction must have one matching check-in fact'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "kind", "user_id"
    INTO sender_kind, sender_user_id
    FROM "wallets"
    WHERE "id" = NEW."sender_wallet_id";

    SELECT "kind", "user_id"
    INTO platform_kind, platform_user_id
    FROM "wallets"
    WHERE "id" = NEW."platform_wallet_id";

    IF sender_kind IS DISTINCT FROM 'USER' OR sender_user_id IS NULL THEN
      RAISE EXCEPTION 'tip sender must be a user wallet'
        USING ERRCODE = '23514';
    END IF;
    IF platform_kind IS DISTINCT FROM 'PLATFORM' OR platform_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'tip platform wallet must have platform kind'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."target_user_id" IS DISTINCT FROM recipient_user_id THEN
      RAISE EXCEPTION 'tip target user must own the recipient wallet'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."target_type" = 'THREAD' AND NOT EXISTS (
      SELECT 1 FROM "threads"
      WHERE "id" = NEW."target_thread_id" AND "owner_id" = recipient_user_id
    ) THEN
      RAISE EXCEPTION 'tip thread owner must own the recipient wallet'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."target_type" = 'MOMENT' AND NOT EXISTS (
      SELECT 1 FROM "moments"
      WHERE "id" = NEW."target_moment_id" AND "author_id" = recipient_user_id
    ) THEN
      RAISE EXCEPTION 'tip moment author must own the recipient wallet'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END
$$;

CREATE FUNCTION "validate_daily_check_in_ledger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_row "wallet_transactions"%ROWTYPE;
  wallet_row "wallets"%ROWTYPE;
BEGIN
  SELECT *
  INTO transaction_row
  FROM "wallet_transactions"
  WHERE "id" = NEW."wallet_transaction_id";

  SELECT *
  INTO wallet_row
  FROM "wallets"
  WHERE "id" = NEW."wallet_id";

  IF transaction_row."type" IS DISTINCT FROM 'DAILY_CHECK_IN'
    OR wallet_row."kind" IS DISTINCT FROM 'USER'
    OR wallet_row."user_id" IS DISTINCT FROM NEW."user_id"
    OR transaction_row."recipient_wallet_id" IS DISTINCT FROM NEW."wallet_id"
    OR transaction_row."date_key" IS DISTINCT FROM NEW."date_key"
    OR transaction_row."gross_amount" IS DISTINCT FROM NEW."reward_amount"
    OR transaction_row."recipient_amount" IS DISTINCT FROM NEW."reward_amount"
    OR transaction_row."platform_amount" IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION 'daily check-in fact must match its wallet transaction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "wallet_transactions_relations_check"
AFTER INSERT ON "wallet_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_wallet_transaction_relations"();

CREATE CONSTRAINT TRIGGER "daily_check_ins_ledger_check"
AFTER INSERT ON "daily_check_ins"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_daily_check_in_ledger"();

CREATE TRIGGER "wallet_transactions_reject_update_delete"
BEFORE UPDATE OR DELETE ON "wallet_transactions"
FOR EACH ROW
EXECUTE FUNCTION "reject_wallet_ledger_mutation"();

CREATE TRIGGER "wallet_transactions_reject_truncate"
BEFORE TRUNCATE ON "wallet_transactions"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_wallet_ledger_mutation"();

CREATE TRIGGER "daily_check_ins_reject_update_delete"
BEFORE UPDATE OR DELETE ON "daily_check_ins"
FOR EACH ROW
EXECUTE FUNCTION "reject_wallet_ledger_mutation"();

CREATE TRIGGER "daily_check_ins_reject_truncate"
BEFORE TRUNCATE ON "daily_check_ins"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_wallet_ledger_mutation"();
