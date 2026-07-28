-- 添加 published 字段，存量帖默认已发布
ALTER TABLE "threads" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true;
-- 新帖默认草稿态
ALTER TABLE "threads" ALTER COLUMN "published" SET DEFAULT false;
