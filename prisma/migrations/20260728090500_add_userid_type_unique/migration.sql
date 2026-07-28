-- 去重：保留最新一条，删除同一 userId+type 的旧记录
DELETE FROM "email_verifications" a
USING "email_verifications" b
WHERE a."created_at" < b."created_at"
  AND a."user_id" = b."user_id"
  AND a."type" = b."type"
  AND a."user_id" IS NOT NULL;

-- 加唯一约束
CREATE UNIQUE INDEX "email_verifications_user_id_type_key" ON "email_verifications"("user_id", "type");
