ALTER TABLE "users"
ADD COLUMN "profile_cover_mobile_media_id" TEXT;

CREATE UNIQUE INDEX "users_profile_cover_mobile_media_id_key"
ON "users"("profile_cover_mobile_media_id");

ALTER TABLE "users"
ADD CONSTRAINT "users_profile_cover_mobile_media_id_fkey"
FOREIGN KEY ("profile_cover_mobile_media_id") REFERENCES "media"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
