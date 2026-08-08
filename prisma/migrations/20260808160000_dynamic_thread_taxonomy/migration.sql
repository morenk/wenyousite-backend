ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THREAD_CATEGORY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THREAD_CATEGORY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TAG_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TAG_UPDATED';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'THREAD_CATEGORY';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'TAG';

CREATE TABLE "thread_category_definitions" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(50) NOT NULL,
  "name" VARCHAR(50) NOT NULL,
  "description" VARCHAR(200),
  "color" VARCHAR(7),
  "icon" VARCHAR(50),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "thread_category_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thread_category_definitions_slug_key"
  ON "thread_category_definitions"("slug");
CREATE UNIQUE INDEX "thread_category_definitions_name_key"
  ON "thread_category_definitions"("name");
CREATE INDEX "thread_category_definitions_is_active_sort_order_name_idx"
  ON "thread_category_definitions"("is_active", "sort_order", "name");

INSERT INTO "thread_category_definitions"
  ("id", "slug", "name", "description", "sort_order")
VALUES
  ('legacy_deduction', 'DEDUCTION', '演绎', '演绎与推理主题', 10),
  ('legacy_nation', 'NATION', '国策', '国家与战略主题', 20),
  ('legacy_rpg', 'RPG', '角色扮演', '角色扮演主题', 30);

ALTER TABLE "threads" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "threads"
  ALTER COLUMN "category" TYPE VARCHAR(50) USING "category"::text;
ALTER TABLE "threads" ALTER COLUMN "category" DROP NOT NULL;
ALTER TABLE "threads"
  ADD CONSTRAINT "threads_category_fkey"
  FOREIGN KEY ("category") REFERENCES "thread_category_definitions"("slug")
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP TYPE "ThreadCategory";

ALTER TABLE "topic_tags"
  ADD COLUMN "description" VARCHAR(200),
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "topic_tags" ALTER COLUMN "color" TYPE VARCHAR(7);
CREATE INDEX "topic_tags_is_active_sort_order_name_idx"
  ON "topic_tags"("is_active", "sort_order", "name");
