-- 为孤儿图片回收的候选查询（status + createdAt 过滤）增加索引
CREATE INDEX "media_status_created_at_idx" ON "media"("status", "created_at");
