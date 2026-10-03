CREATE TABLE "mobile_download_artifacts" (
  "release_id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "apk_sha256" TEXT NOT NULL,
  "apk_size" TEXT NOT NULL,
  "storage_bucket" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "public_url" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_download_artifacts_pkey" PRIMARY KEY ("release_id"),
  CONSTRAINT "mobile_download_artifacts_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "mobile_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mobile_download_artifacts_storage_bucket_storage_key_key" ON "mobile_download_artifacts"("storage_bucket", "storage_key");
