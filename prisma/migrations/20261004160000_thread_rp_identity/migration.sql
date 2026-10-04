-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "rp_identity_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rp_identity_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "author_identity_snapshot" JSONB,
ADD COLUMN     "identity_avatar_media_id" TEXT,
ADD COLUMN     "mention_identity_snapshots" JSONB;

-- CreateTable
CREATE TABLE "thread_identities" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nickname" VARCHAR(24),
    "avatar_media_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_identity_aliases" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "nickname" VARCHAR(24) NOT NULL,

    CONSTRAINT "thread_identity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_identities_avatar_media_id_idx" ON "thread_identities"("avatar_media_id");

-- CreateIndex
CREATE INDEX "thread_identities_user_id_idx" ON "thread_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_identities_thread_id_user_id_key" ON "thread_identities"("thread_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_identity_aliases_identity_id_nickname_key" ON "thread_identity_aliases"("identity_id", "nickname");

-- CreateIndex
CREATE INDEX "posts_identity_avatar_media_id_idx" ON "posts"("identity_avatar_media_id");

-- AddForeignKey
ALTER TABLE "thread_identities" ADD CONSTRAINT "thread_identities_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_identities" ADD CONSTRAINT "thread_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_identities" ADD CONSTRAINT "thread_identities_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_identity_aliases" ADD CONSTRAINT "thread_identity_aliases_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "thread_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_identity_avatar_media_id_fkey" FOREIGN KEY ("identity_avatar_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
