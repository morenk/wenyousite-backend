CREATE TYPE "DirectConversationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED');

CREATE TABLE "direct_conversations" (
    "id" TEXT NOT NULL,
    "first_user_id" TEXT NOT NULL,
    "second_user_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "status" "DirectConversationStatus" NOT NULL DEFAULT 'PENDING',
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "direct_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_conversations_canonical_users_check" CHECK ("first_user_id" < "second_user_id"),
    CONSTRAINT "direct_conversations_request_direction_check" CHECK (
        "requester_id" <> "recipient_id"
        AND "requester_id" IN ("first_user_id", "second_user_id")
        AND "recipient_id" IN ("first_user_id", "second_user_id")
    )
);

CREATE TABLE "direct_conversation_participants" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "media_id" TEXT,
    "client_request_id" UUID NOT NULL,
    "content" TEXT,
    "read_at" TIMESTAMP(3),
    "recalled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_messages_sender_recipient_check" CHECK ("sender_id" <> "recipient_id"),
    CONSTRAINT "direct_messages_content_or_media_check" CHECK (
        "content" IS NOT NULL OR "media_id" IS NOT NULL OR "recalled_at" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "direct_conversations_first_user_id_second_user_id_key"
    ON "direct_conversations"("first_user_id", "second_user_id");
CREATE INDEX "direct_conversations_requests_idx"
    ON "direct_conversations"("status", "recipient_id", "last_message_at" DESC);
CREATE UNIQUE INDEX "direct_conversation_participants_conversation_id_user_id_key"
    ON "direct_conversation_participants"("conversation_id", "user_id");
CREATE INDEX "direct_conversation_participants_inbox_idx"
    ON "direct_conversation_participants"("user_id", "archived_at", "conversation_id");
CREATE UNIQUE INDEX "direct_messages_media_id_key" ON "direct_messages"("media_id");
CREATE UNIQUE INDEX "direct_messages_sender_id_client_request_id_key"
    ON "direct_messages"("sender_id", "client_request_id");
CREATE INDEX "direct_messages_history_idx"
    ON "direct_messages"("conversation_id", "created_at" DESC, "id" DESC);
CREATE INDEX "direct_messages_unread_idx"
    ON "direct_messages"("recipient_id", "read_at", "created_at" DESC);

ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_first_user_id_fkey"
    FOREIGN KEY ("first_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_second_user_id_fkey"
    FOREIGN KEY ("second_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_requester_id_fkey"
    FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_participants" ADD CONSTRAINT "direct_conversation_participants_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_conversation_participants" ADD CONSTRAINT "direct_conversation_participants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_media_id_fkey"
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
