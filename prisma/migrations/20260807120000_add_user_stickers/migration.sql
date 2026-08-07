CREATE TYPE "StickerImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "sticker_assets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "thumbnail_url" TEXT NOT NULL,
    "thumbnail_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'image/webp',
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "frame_count" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sticker_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sticker_collections" (
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sticker_collections_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "user_stickers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_stickers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sticker_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_media_id" TEXT,
    "client_request_id" UUID NOT NULL,
    "status" "StickerImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "already_saved" BOOLEAN NOT NULL DEFAULT false,
    "asset_id" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sticker_imports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "direct_messages" ADD COLUMN "sticker_asset_id" TEXT;
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_content_or_media_check";
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_content_or_media_check" CHECK (
    "content" IS NOT NULL OR "media_id" IS NOT NULL OR "sticker_asset_id" IS NOT NULL OR "recalled_at" IS NOT NULL
);

CREATE UNIQUE INDEX "sticker_assets_url_key" ON "sticker_assets"("url");
CREATE UNIQUE INDEX "sticker_assets_key_key" ON "sticker_assets"("key");
CREATE UNIQUE INDEX "sticker_assets_thumbnail_key_key" ON "sticker_assets"("thumbnail_key");
CREATE UNIQUE INDEX "sticker_assets_content_hash_key" ON "sticker_assets"("content_hash");
CREATE INDEX "sticker_assets_created_at_idx" ON "sticker_assets"("created_at");
CREATE UNIQUE INDEX "user_stickers_user_id_asset_id_key" ON "user_stickers"("user_id", "asset_id");
CREATE INDEX "user_stickers_user_id_position_created_at_idx" ON "user_stickers"("user_id", "position", "created_at");
CREATE INDEX "user_stickers_user_id_last_used_at_idx" ON "user_stickers"("user_id", "last_used_at" DESC);
CREATE UNIQUE INDEX "sticker_imports_user_id_client_request_id_key" ON "sticker_imports"("user_id", "client_request_id");
CREATE INDEX "sticker_imports_user_id_status_created_at_idx" ON "sticker_imports"("user_id", "status", "created_at");
CREATE INDEX "sticker_imports_source_media_id_status_idx" ON "sticker_imports"("source_media_id", "status");
CREATE INDEX "direct_messages_sticker_asset_id_idx" ON "direct_messages"("sticker_asset_id");

ALTER TABLE "sticker_collections" ADD CONSTRAINT "sticker_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_stickers" ADD CONSTRAINT "user_stickers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_stickers" ADD CONSTRAINT "user_stickers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "sticker_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sticker_imports" ADD CONSTRAINT "sticker_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sticker_imports" ADD CONSTRAINT "sticker_imports_source_media_id_fkey" FOREIGN KEY ("source_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sticker_imports" ADD CONSTRAINT "sticker_imports_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "sticker_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sticker_asset_id_fkey" FOREIGN KEY ("sticker_asset_id") REFERENCES "sticker_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
