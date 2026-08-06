-- 历史注销账号去除原始用户名、邮箱和头像引用；头像随后由引用感知的孤儿媒体任务安全回收。
UPDATE "users"
SET
  "username" = 'deleted_' || RIGHT("id", 16),
  "email" = 'deleted_' || "id" || '@deleted.invalid',
  "avatar" = NULL
WHERE "deleted_at" IS NOT NULL;
