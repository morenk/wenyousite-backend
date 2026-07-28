-- 标题改为可空（草稿可暂不填标题）
ALTER TABLE "threads" ALTER COLUMN "title" DROP NOT NULL;
-- 新增发布时刻
ALTER TABLE "threads" ADD COLUMN "published_at" TIMESTAMPTZ;
-- 存量已发布帖回填（以创建时间作为发布时刻）
UPDATE "threads" SET "published_at" = "created_at" WHERE "published" = true;
