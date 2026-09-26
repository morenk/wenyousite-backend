ALTER TYPE "AuditAction" ADD VALUE 'MOBILE_RELEASE_UPDATED';
ALTER TYPE "AuditTargetType" ADD VALUE 'MOBILE_RELEASE';
CREATE TABLE "mobile_releases" (
  "id" TEXT PRIMARY KEY, "platform" TEXT NOT NULL CHECK (platform = 'android'),
  "version_name" TEXT NOT NULL, "build_number" INTEGER NOT NULL CHECK (build_number BETWEEN 1 AND 2100000000),
  "summary" TEXT NOT NULL, "items" TEXT[] NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "confirmed_revision" INTEGER, "confirmed_summary" TEXT, "confirmed_items" TEXT[] NOT NULL,
  "confirmed_at" TIMESTAMP(3), "published_revision" INTEGER, "published_summary" TEXT,
  "published_items" TEXT[] NOT NULL, "published_at" TIMESTAMP(3), "promotion_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "mobile_releases_platform_build_number_key" ON "mobile_releases"("platform", "build_number");
CREATE UNIQUE INDEX "mobile_releases_promotion_id_key" ON "mobile_releases"("promotion_id");
CREATE INDEX "mobile_releases_platform_published_at_build_number_idx" ON "mobile_releases"("platform", "published_at", "build_number");
CREATE TABLE "mobile_release_promotions" (
  "id" TEXT PRIMARY KEY, "release_id" TEXT NOT NULL REFERENCES "mobile_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "apk_sha256" TEXT NOT NULL, "apk_size" TEXT NOT NULL, "update_url" TEXT NOT NULL,
  "previous_published_revision" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "mobile_release_promotions_release_id_status_idx" ON "mobile_release_promotions"("release_id", "status");
