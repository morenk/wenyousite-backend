BEGIN;

-- DropIndex
DROP INDEX "text_font_versions_family_id_artifact_key_key";

-- AlterTable
ALTER TABLE "text_font_families" ADD COLUMN     "last_published_version_id" TEXT,
ADD COLUMN "specimen_automatic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "text_font_build_jobs" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "parameters_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "upload_authorization" JSONB;

-- AlterTable
ALTER TABLE "text_font_versions" ADD COLUMN     "parameters_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reuse_key" TEXT,
ADD COLUMN     "upload_authorization" JSONB;

-- AlterTable
ALTER TABLE "text_font_catalog_head" ADD COLUMN     "listing_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "text_font_submissions" (
    "id" UUID NOT NULL,
    "family_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "request_sha256" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "text_font_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_font_process_requests" (
    "submission_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_font_process_requests_pkey" PRIMARY KEY ("submission_id","request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "text_font_submissions_job_id_key" ON "text_font_submissions"("job_id");

-- CreateIndex
CREATE INDEX "text_font_submissions_family_id_created_at_idx" ON "text_font_submissions"("family_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_families_last_published_version_id_key" ON "text_font_families"("last_published_version_id");

-- CreateIndex
CREATE INDEX "text_font_versions_family_id_artifact_key_idx" ON "text_font_versions"("family_id", "artifact_key");

-- CreateIndex
CREATE UNIQUE INDEX "text_font_versions_family_id_reuse_key_key" ON "text_font_versions"("family_id", "reuse_key");

-- AddForeignKey
ALTER TABLE "text_font_families" ADD CONSTRAINT "text_font_families_last_published_version_id_fkey" FOREIGN KEY ("last_published_version_id") REFERENCES "text_font_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_submissions" ADD CONSTRAINT "text_font_submissions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "text_font_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_submissions" ADD CONSTRAINT "text_font_submissions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "text_font_build_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_font_process_requests" ADD CONSTRAINT "text_font_process_requests_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "text_font_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 当前指针是首选事实。审计按发布目录修订排序，不能用版本号或首次发布时间代替回滚顺序。
UPDATE text_font_families SET last_published_version_id = current_version_id
WHERE current_version_id IS NOT NULL;

DO $$
DECLARE affected TEXT;
BEGIN
  WITH evidence AS (
    SELECT v.family_id, a.target_id,
      rank() OVER (PARTITION BY v.family_id ORDER BY (a.metadata->>'revision')::bigint DESC) AS rank
    FROM audit_logs a JOIN text_font_versions v ON v.id = a.target_id
    JOIN text_font_families f ON f.id = v.family_id
    WHERE a.action = 'TEXT_FONT_PUBLISHED' AND a.target_type = 'TEXT_FONT'
      AND a.metadata->>'revision' ~ '^[0-9]{1,10}$'
      AND f.current_version_id IS NULL AND v.published_at IS NOT NULL
  )
  SELECT string_agg(family_id, ', ' ORDER BY family_id) INTO affected
  FROM (SELECT family_id FROM evidence WHERE rank = 1 GROUP BY family_id HAVING count(DISTINCT target_id) > 1) ambiguous;
  IF affected IS NOT NULL THEN RAISE EXCEPTION 'FONT_LAST_PUBLISHED_AMBIGUOUS: %', affected; END IF;
END $$;

WITH latest AS (
  SELECT DISTINCT ON (v.family_id) v.family_id, v.id
  FROM audit_logs a JOIN text_font_versions v ON v.id = a.target_id
  WHERE a.action = 'TEXT_FONT_PUBLISHED' AND a.target_type = 'TEXT_FONT'
    AND a.metadata->>'revision' ~ '^[0-9]{1,10}$' AND v.published_at IS NOT NULL
  ORDER BY v.family_id, (a.metadata->>'revision')::bigint DESC, a.id DESC
)
UPDATE text_font_families f SET last_published_version_id = latest.id
FROM latest WHERE f.id = latest.family_id AND f.last_published_version_id IS NULL;

-- 缺发布审计时，目录只在家族恰有一个历史发布版本时足以消除歧义；
-- 停用期间回滚不一定写入可选目录，多个候选必须失败，不能猜测最后目录成员。
WITH single_published AS (
  SELECT family_id, min(id) AS id FROM text_font_versions
  WHERE published_at IS NOT NULL GROUP BY family_id HAVING count(*) = 1
), observed AS (
  SELECT DISTINCT single_published.family_id, single_published.id FROM single_published
  JOIN text_font_catalog_releases r ON EXISTS (
    SELECT 1 FROM jsonb_array_elements(r.entries) e
    WHERE e->>'familyId' = single_published.family_id AND e->>'versionId' = single_published.id
  )
)
UPDATE text_font_families f SET last_published_version_id = observed.id
FROM observed WHERE f.id = observed.family_id AND f.last_published_version_id IS NULL;

DO $$
DECLARE affected TEXT;
BEGIN
  SELECT string_agg(f.id, ', ' ORDER BY f.id) INTO affected
  FROM text_font_families f LEFT JOIN text_font_versions v ON v.id = f.last_published_version_id
  WHERE (f.last_published_version_id IS NULL AND EXISTS (
    SELECT 1 FROM text_font_versions history WHERE history.family_id = f.id AND history.published_at IS NOT NULL
  )) OR (f.last_published_version_id IS NOT NULL AND (
    v.family_id <> f.id OR v.published_at IS NULL OR
    (f.current_version_id IS NULL AND v.withdrawn_at IS NULL)
  ));
  IF affected IS NOT NULL THEN RAISE EXCEPTION 'FONT_LAST_PUBLISHED_UNPROVEN: %', affected; END IF;
END $$;

-- 旧构建身份已包含完整配置；保留其去重键，撤回版本不再占用可复用身份。
UPDATE text_font_versions SET reuse_key = artifact_key WHERE withdrawn_at IS NULL;
ALTER TABLE text_font_versions ADD CONSTRAINT text_font_version_reuse_active
  CHECK (withdrawn_at IS NULL OR reuse_key IS NULL);
ALTER TABLE text_font_versions ADD CONSTRAINT text_font_version_parameters
  CHECK (parameters_version IN (1, 2) AND (parameters_version = 1 OR upload_authorization IS NOT NULL));
ALTER TABLE text_font_build_jobs ADD CONSTRAINT text_font_job_parameters
  CHECK (parameters_version IN (1, 2) AND (parameters_version = 1 OR upload_authorization IS NOT NULL));
ALTER TABLE text_font_catalog_head ADD CONSTRAINT text_font_listing_revision_nonnegative CHECK (listing_revision >= 0);

COMMIT;
