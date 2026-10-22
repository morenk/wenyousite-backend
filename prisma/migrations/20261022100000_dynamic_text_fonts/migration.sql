-- CreateEnum
CREATE TYPE "TextFontJobStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_DRAFT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_SOURCE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_PROCESS_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_VERSION_READY';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_ENABLED_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_WITHDRAWN';
ALTER TYPE "AuditAction" ADD VALUE 'TEXT_FONT_IMPORTED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'TEXT_FONT';

-- CreateTable
CREATE TABLE "text_font_families" (
    "id" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "current_version_id" TEXT,
    "next_version" INTEGER NOT NULL DEFAULT 1,
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "text_font_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_font_build_jobs" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_bytes" INTEGER NOT NULL,
    "source_format" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "status" "TextFontJobStatus" NOT NULL DEFAULT 'DRAFT',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "build_key" TEXT,
    "version_id" TEXT,
    "claim_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "text_font_build_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_font_artifacts" (
    "build_key" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "toolchain" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "assets" JSONB NOT NULL,
    "manifest_sha" TEXT NOT NULL,
    "manifest_size" INTEGER NOT NULL,
    "specimen_sha" TEXT NOT NULL,
    "specimen_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_font_artifacts_pkey" PRIMARY KEY ("build_key")
);

-- CreateTable
CREATE TABLE "text_font_versions" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "artifact_key" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_font_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_font_catalog_head" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "release_id" TEXT,

    CONSTRAINT "text_font_catalog_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_font_catalog_releases" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "entries" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_font_catalog_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "text_font_families_current_version_id_key" ON "text_font_families"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_families_legacy_id_key" ON "text_font_families"("legacy_id");

-- CreateIndex
CREATE INDEX "text_font_build_jobs_family_id_created_at_idx" ON "text_font_build_jobs"("family_id", "created_at");

-- CreateIndex
CREATE INDEX "text_font_build_jobs_status_lease_expires_at_idx" ON "text_font_build_jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_versions_family_id_version_number_key" ON "text_font_versions"("family_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_versions_family_id_artifact_key_key" ON "text_font_versions"("family_id", "artifact_key");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_catalog_head_release_id_key" ON "text_font_catalog_head"("release_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_catalog_releases_revision_key" ON "text_font_catalog_releases"("revision");

-- AddForeignKey
ALTER TABLE "text_font_families" ADD CONSTRAINT "text_font_families_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "text_font_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_build_jobs" ADD CONSTRAINT "text_font_build_jobs_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "text_font_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_build_jobs" ADD CONSTRAINT "text_font_build_jobs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "text_font_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_versions" ADD CONSTRAINT "text_font_versions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "text_font_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_versions" ADD CONSTRAINT "text_font_versions_artifact_key_fkey" FOREIGN KEY ("artifact_key") REFERENCES "text_font_artifacts"("build_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_catalog_head" ADD CONSTRAINT "text_font_catalog_head_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "text_font_catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 首次目录为空；此后的目录修订与状态切换在同一事务串行化。
INSERT INTO "text_font_catalog_releases" ("id", "revision", "entries")
VALUES ('tfc_00000000000000000000000000000000', 0, '[]');
INSERT INTO "text_font_catalog_head" ("id", "revision", "release_id")
VALUES (1, 0, 'tfc_00000000000000000000000000000000');
ALTER TABLE "text_font_catalog_head" ADD CONSTRAINT "text_font_single_head" CHECK ("id" = 1 AND "revision" >= 0);
ALTER TABLE "text_font_families" ADD CONSTRAINT "text_font_family_identity" CHECK ("id" ~ '^tff_[a-f0-9]{32}$' AND "revision" > 0 AND "next_version" > 0);
ALTER TABLE "text_font_versions" ADD CONSTRAINT "text_font_version_identity" CHECK ("id" ~ '^tfv_[a-f0-9]{32}$' AND "version_number" > 0);
ALTER TABLE "text_font_build_jobs" ADD CONSTRAINT "text_font_source_bounds" CHECK ("id" ~ '^tfj_[a-f0-9]{32}$' AND "source_sha256" ~ '^[a-f0-9]{64}$' AND "source_bytes" BETWEEN 1 AND 67108864 AND "source_format" IN ('ttf', 'otf') AND "attempt" >= 0);
ALTER TABLE "text_font_artifacts" ADD CONSTRAINT "text_font_artifact_bounds" CHECK ("build_key" ~ '^[a-f0-9]{64}$' AND "manifest_sha" ~ '^[a-f0-9]{64}$' AND "specimen_sha" ~ '^[a-f0-9]{64}$' AND "manifest_size" BETWEEN 1 AND 4194304 AND "specimen_size" BETWEEN 1 AND 4194304);
