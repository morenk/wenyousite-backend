-- 历史行保持 NULL，不从系统更新时间推算正文编辑时间。
ALTER TABLE "posts" ADD COLUMN "edited_at" TIMESTAMP(3);
