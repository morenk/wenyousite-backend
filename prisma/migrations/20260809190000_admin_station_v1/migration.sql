ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'DIRECT_MESSAGE';
ALTER TYPE "ReportReasonCode" ADD VALUE IF NOT EXISTS 'IMPERSONATION_OR_FRAUD';
ALTER TYPE "ReportReasonCode" ADD VALUE IF NOT EXISTS 'INTELLECTUAL_PROPERTY';

CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ModerationDecisionAction" AS ENUM ('HIDE_CONTENT', 'SUSPEND_USER', 'BAN_USER');
CREATE TYPE "ModerationAppealStatus" AS ENUM ('PENDING', 'UPHELD', 'OVERTURNED');
CREATE TYPE "AdminInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED');
CREATE TYPE "AdminSecurityEventType" AS ENUM (
  'LOGIN_CHALLENGE_CREATED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'SESSION_REVOKED',
  'STEP_UP_SUCCEEDED',
  'STEP_UP_FAILED',
  'PRIVATE_EVIDENCE_VIEWED'
);
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'CANCELED', 'FAILED');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_INVITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_INVITE_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_INVITE_CANCELED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN_TRANSFERRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_SESSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CASE_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CASE_DISMISSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPEAL_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPEAL_UPHELD';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPEAL_OVERTURNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_SESSIONS_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_REQUESTED_BY_ADMIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_CAMPAIGN_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_CAMPAIGN_CANCELED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THREAD_CATEGORY_MERGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TAG_MERGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SITE_SETTINGS_UPDATED';

ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'MODERATION_CASE';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'MODERATION_DECISION';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'MODERATION_APPEAL';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'ADMIN_INVITE';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'ADMIN_SESSION';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'NOTIFICATION_CAMPAIGN';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'SITE_SETTINGS';

CREATE TABLE "admin_auth_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "purpose" VARCHAR(32) NOT NULL,
  "code_hash" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "ip" TEXT,
  "user_agent" VARCHAR(512),
  "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "elevated_until" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_invites" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "invited_by_id" TEXT NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "status" "AdminInviteStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_security_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "type" "AdminSecurityEventType" NOT NULL,
  "ip" TEXT,
  "user_agent" VARCHAR(512),
  "metadata" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_security_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moderation_cases" (
  "id" TEXT NOT NULL,
  "target_type" "ReportTargetType" NOT NULL,
  "target_id" TEXT NOT NULL,
  "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "resolved_by_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moderation_decisions" (
  "id" TEXT NOT NULL,
  "case_id" TEXT,
  "target_type" "ReportTargetType" NOT NULL,
  "target_id" TEXT NOT NULL,
  "action" "ModerationDecisionAction" NOT NULL,
  "policy_code" "ReportReasonCode" NOT NULL,
  "public_explanation" VARCHAR(500) NOT NULL,
  "internal_note" VARCHAR(1000),
  "actor_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "reversed_at" TIMESTAMP(3),
  "reversed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moderation_appeals" (
  "id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "appellant_id" TEXT NOT NULL,
  "statement" VARCHAR(2000) NOT NULL,
  "status" "ModerationAppealStatus" NOT NULL DEFAULT 'PENDING',
  "handled_by_id" TEXT,
  "handled_note" VARCHAR(1000),
  "handled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_notification_campaigns" (
  "id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "title" VARCHAR(60) NOT NULL,
  "content" VARCHAR(1000) NOT NULL,
  "destination_type" VARCHAR(32),
  "destination_id" TEXT,
  "audience" JSONB NOT NULL,
  "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "estimated_count" INTEGER NOT NULL DEFAULT 0,
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "failure_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_notification_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_operational_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "registration_paused_until" TIMESTAMP(3),
  "content_writes_paused_until" TIMESTAMP(3),
  "maintenance_title" VARCHAR(60),
  "maintenance_content" VARCHAR(500),
  "maintenance_starts_at" TIMESTAMP(3),
  "maintenance_ends_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "site_operational_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_sensitive_contexts" (
  "audit_id" TEXT NOT NULL,
  "ip" TEXT,
  "request_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audit_sensitive_contexts_pkey" PRIMARY KEY ("audit_id")
);

ALTER TABLE "thread_category_definitions" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "topic_tags" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN "campaign_id" TEXT;
ALTER TABLE "reports" ADD COLUMN "case_id" TEXT;
ALTER TABLE "user_sanctions" ADD COLUMN "decision_id" TEXT;

CREATE UNIQUE INDEX "users_single_super_admin_idx"
  ON "users" ("role") WHERE "role" = 'SUPER_ADMIN' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE UNIQUE INDEX "admin_sessions_active_user_key"
  ON "admin_sessions"("user_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "admin_invites_token_hash_key" ON "admin_invites"("token_hash");
CREATE UNIQUE INDEX "admin_invites_pending_user_key"
  ON "admin_invites"("user_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "moderation_cases_open_target_key"
  ON "moderation_cases"("target_type", "target_id") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "moderation_appeals_decision_id_key" ON "moderation_appeals"("decision_id");
CREATE UNIQUE INDEX "user_sanctions_decision_id_key" ON "user_sanctions"("decision_id");

CREATE INDEX "admin_auth_challenges_user_id_purpose_created_at_idx" ON "admin_auth_challenges"("user_id", "purpose", "created_at" DESC);
CREATE INDEX "admin_auth_challenges_expires_at_idx" ON "admin_auth_challenges"("expires_at");
CREATE INDEX "admin_sessions_user_id_revoked_at_idx" ON "admin_sessions"("user_id", "revoked_at");
CREATE INDEX "admin_sessions_expires_at_revoked_at_idx" ON "admin_sessions"("expires_at", "revoked_at");
CREATE INDEX "admin_invites_user_id_status_expires_at_idx" ON "admin_invites"("user_id", "status", "expires_at");
CREATE INDEX "admin_invites_invited_by_id_created_at_idx" ON "admin_invites"("invited_by_id", "created_at" DESC);
CREATE INDEX "admin_security_events_created_at_id_idx" ON "admin_security_events"("created_at" DESC, "id" DESC);
CREATE INDEX "admin_security_events_expires_at_idx" ON "admin_security_events"("expires_at");
CREATE INDEX "moderation_cases_status_created_at_id_idx" ON "moderation_cases"("status", "created_at" DESC, "id" DESC);
CREATE INDEX "moderation_cases_target_type_target_id_created_at_idx" ON "moderation_cases"("target_type", "target_id", "created_at" DESC);
CREATE INDEX "moderation_decisions_target_type_target_id_active_created_at_idx" ON "moderation_decisions"("target_type", "target_id", "active", "created_at" DESC);
CREATE INDEX "moderation_decisions_case_id_created_at_idx" ON "moderation_decisions"("case_id", "created_at");
CREATE INDEX "moderation_appeals_status_created_at_id_idx" ON "moderation_appeals"("status", "created_at" DESC, "id" DESC);
CREATE INDEX "moderation_appeals_appellant_id_created_at_idx" ON "moderation_appeals"("appellant_id", "created_at" DESC);
CREATE INDEX "system_notification_campaigns_status_scheduled_at_idx" ON "system_notification_campaigns"("status", "scheduled_at");
CREATE INDEX "system_notification_campaigns_created_at_id_idx" ON "system_notification_campaigns"("created_at" DESC, "id" DESC);
CREATE INDEX "audit_sensitive_contexts_expires_at_idx" ON "audit_sensitive_contexts"("expires_at");
CREATE INDEX "notifications_campaign_id_is_read_idx" ON "notifications"("campaign_id", "is_read");
CREATE INDEX "reports_case_id_created_at_idx" ON "reports"("case_id", "created_at");

ALTER TABLE "admin_auth_challenges" ADD CONSTRAINT "admin_auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_security_events" ADD CONSTRAINT "admin_security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_appellant_id_fkey" FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_notification_campaigns" ADD CONSTRAINT "system_notification_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "thread_category_definitions" ADD CONSTRAINT "thread_category_definitions_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "thread_category_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "topic_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "system_notification_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_sensitive_contexts" ADD CONSTRAINT "audit_sensitive_contexts_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "site_operational_settings" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "audit_sensitive_contexts" ("audit_id", "ip", "request_id", "expires_at")
SELECT "id", "ip", "request_id", "created_at" + INTERVAL '1 year'
FROM "audit_logs"
WHERE ("ip" IS NOT NULL OR "request_id" IS NOT NULL)
  AND "created_at" + INTERVAL '1 year' > CURRENT_TIMESTAMP
ON CONFLICT ("audit_id") DO NOTHING;

INSERT INTO "moderation_cases" ("id", "target_type", "target_id", "status", "created_at", "updated_at")
SELECT
  'legacy_case_' || md5("target_type"::text || ':' || "target_id"),
  "target_type",
  "target_id",
  'OPEN'::"ModerationCaseStatus",
  MIN("created_at"),
  CURRENT_TIMESTAMP
FROM "reports"
WHERE "status" = 'PENDING'
GROUP BY "target_type", "target_id"
ON CONFLICT DO NOTHING;

UPDATE "reports" AS report
SET "case_id" = 'legacy_case_' || md5(report."target_type"::text || ':' || report."target_id")
WHERE report."status" = 'PENDING' AND report."case_id" IS NULL;

INSERT INTO "moderation_cases" ("id", "target_type", "target_id", "status", "resolved_by_id", "resolved_at", "created_at", "updated_at")
SELECT
  'legacy_case_' || "id",
  "target_type",
  "target_id",
  CASE WHEN "status" = 'DISMISSED' THEN 'DISMISSED'::"ModerationCaseStatus" ELSE 'RESOLVED'::"ModerationCaseStatus" END,
  "handled_by",
  "handled_at",
  "created_at",
  "updated_at"
FROM "reports"
WHERE "status" <> 'PENDING'
ON CONFLICT DO NOTHING;

UPDATE "reports"
SET "case_id" = 'legacy_case_' || "id"
WHERE "status" <> 'PENDING' AND "case_id" IS NULL;
