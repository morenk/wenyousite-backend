-- 公开主题帖首页：按创建时间与最近活动时间排序。
CREATE INDEX "threads_public_created_idx"
ON "threads" ("published", "visibility", "deleted_at", "pinned" DESC, "created_at" DESC);

CREATE INDEX "threads_public_active_idx"
ON "threads" ("published", "visibility", "deleted_at", "pinned" DESC, "updated_at" DESC);

-- 用户主页的创建帖、参与帖，以及粉丝列表。
CREATE INDEX "threads_owner_created_idx"
ON "threads" ("owner_id", "published", "deleted_at", "created_at" DESC);

CREATE INDEX "thread_members_user_played_idx"
ON "thread_members" ("user_id", "player_marked", "joined_at" DESC);

CREATE INDEX "user_follows_followers_idx"
ON "user_follows" ("following_id", "created_at" DESC);

-- 楼层首页游标分页（排除正文、楼中楼和软删除记录）。
CREATE INDEX "posts_floor_page_idx"
ON "posts" ("subthread_id", "kind", "deleted_at", "floor_number");
