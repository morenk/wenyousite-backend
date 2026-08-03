-- 为独立楼中楼阅读页的 parentPostId + createdAt 游标分页增加索引
CREATE INDEX "posts_parent_post_id_created_at_idx" ON "posts"("parent_post_id", "created_at");
