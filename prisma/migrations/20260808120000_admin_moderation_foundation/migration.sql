-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'THREAD', 'POST');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReportReasonCode" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_OR_THREATS', 'SEXUAL_CONTENT', 'VIOLENT_CONTENT', 'PERSONAL_INFORMATION', 'ILLEGAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "UserSanctionType" AS ENUM ('SUSPENSION', 'BAN');

-- CreateEnum
CREATE TYPE "ContentRemovalSource" AS ENUM ('AUTHOR', 'OWNER', 'THREAD_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SUPER_ADMIN_BOOTSTRAPPED', 'ADMIN_ROLE_GRANTED', 'ADMIN_ROLE_REVOKED', 'USER_SUSPENDED', 'USER_BANNED', 'USER_SANCTION_REVOKED', 'CONTENT_HIDDEN', 'CONTENT_RESTORED', 'REPORT_RESOLVED', 'REPORT_DISMISSED', 'SYSTEM_NOTIFICATION_SENT');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('USER', 'THREAD', 'POST', 'REPORT', 'SYSTEM_NOTIFICATION');

-- AlterTable: retain soft-delete visibility while recording who initiated it.
ALTER TABLE "threads"
  ADD COLUMN "removal_source" "ContentRemovalSource",
  ADD COLUMN "removed_by_id" TEXT,
  ADD COLUMN "removal_reason" TEXT;

ALTER TABLE "posts"
  ADD COLUMN "removal_source" "ContentRemovalSource",
  ADD COLUMN "removed_by_id" TEXT,
  ADD COLUMN "removal_reason" TEXT;

-- AlterTable: make reports typed and preserve legacy free-text reasons.
ALTER TABLE "reports"
  ALTER COLUMN "reporter_id" DROP NOT NULL,
  ADD COLUMN "reason_code" "ReportReasonCode" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "details" TEXT,
  ADD COLUMN "target_snapshot" JSONB,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "reports" SET "details" = "reason" WHERE "reason" IS NOT NULL;
ALTER TABLE "reports" DROP COLUMN "reason";

ALTER TABLE "reports"
  ALTER COLUMN "target_type" TYPE "ReportTargetType"
    USING (CASE WHEN "target_type" IN ('USER', 'THREAD', 'POST') THEN "target_type" ELSE 'USER' END)::"ReportTargetType",
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ReportStatus"
    USING (CASE WHEN "status" IN ('PENDING', 'RESOLVED', 'DISMISSED') THEN "status" ELSE 'PENDING' END)::"ReportStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable: evolve the legacy audit table without attempting a risky text-to-json cast.
ALTER TABLE "audit_logs" RENAME COLUMN "admin_id" TO "actor_id";
ALTER TABLE "audit_logs"
  ALTER COLUMN "actor_id" DROP NOT NULL,
  ADD COLUMN "report_id" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "request_id" TEXT;

ALTER TABLE "audit_logs"
  ALTER COLUMN "action" TYPE "AuditAction"
    USING (CASE WHEN "action" = 'SYSTEM_NOTIFICATION' THEN 'SYSTEM_NOTIFICATION_SENT' ELSE 'SYSTEM_NOTIFICATION_SENT' END)::"AuditAction",
  ALTER COLUMN "target_type" TYPE "AuditTargetType"
    USING (CASE WHEN "target_type" IN ('USER', 'THREAD', 'POST', 'REPORT', 'SYSTEM_NOTIFICATION') THEN "target_type" ELSE 'SYSTEM_NOTIFICATION' END)::"AuditTargetType";

-- CreateTable
CREATE TABLE "user_sanctions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "UserSanctionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "report_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_by_id" TEXT,
  "revoke_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sanctions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "reports_status_created_at_id_idx" ON "reports"("status", "created_at" DESC, "id" DESC);
CREATE INDEX "reports_target_type_target_id_created_at_idx" ON "reports"("target_type", "target_id", "created_at" DESC);
CREATE UNIQUE INDEX "reports_one_pending_per_reporter_target_idx" ON "reports"("reporter_id", "target_type", "target_id") WHERE "status" = 'PENDING' AND "reporter_id" IS NOT NULL;

CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at" DESC, "id" DESC);
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at" DESC);
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);
CREATE INDEX "audit_logs_report_id_created_at_idx" ON "audit_logs"("report_id", "created_at" DESC);

CREATE INDEX "user_sanctions_user_id_revoked_at_ends_at_idx" ON "user_sanctions"("user_id", "revoked_at", "ends_at");
CREATE INDEX "user_sanctions_created_by_id_created_at_idx" ON "user_sanctions"("created_by_id", "created_at" DESC);
CREATE INDEX "user_sanctions_report_id_idx" ON "user_sanctions"("report_id");
CREATE UNIQUE INDEX "user_sanctions_one_open_per_user_idx" ON "user_sanctions"("user_id") WHERE "revoked_at" IS NULL;

-- Foreign keys
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_admin_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
