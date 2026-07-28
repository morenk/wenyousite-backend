-- 1) 去重：保留最早一条，删除同一 email+type 的重复记录
DELETE FROM "email_verifications" a
USING "email_verifications" b
WHERE a."ctid" > b."ctid"
  AND a."email" = b."email"
  AND a."type" = b."type";

-- 2) 加唯一约束防未来重复
CREATE UNIQUE INDEX "email_verifications_email_type_key" ON "email_verifications"("email", "type");

-- 3) 用户表加登录锁定字段
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);
