CREATE TYPE "MediaPurpose" AS ENUM (
  'AVATAR',
  'PROFILE_COVER',
  'DIRECT_MESSAGE',
  'MOMENT',
  'MOMENT_COMMENT',
  'RICH_CONTENT',
  'STICKER_SOURCE',
  'LEGACY'
);

ALTER TABLE "media"
ADD COLUMN "staging_key" TEXT,
ADD COLUMN "purpose" "MediaPurpose" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "animated" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "media_staging_key_key" ON "media"("staging_key");
