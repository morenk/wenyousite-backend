-- 详情实时聚合按主题访问既有关系，不回填或删除用户数据。
CREATE INDEX "user_bookmarks_thread_idx" ON "user_bookmarks"("thread_id");
CREATE INDEX "subscriptions_thread_type_target_idx" ON "subscriptions"("thread_id", "type", "target_user_id");
