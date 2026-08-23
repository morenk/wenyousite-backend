CREATE INDEX "thread_members_user_role_thread_idx"
ON "thread_members"("user_id", "role", "thread_id");
