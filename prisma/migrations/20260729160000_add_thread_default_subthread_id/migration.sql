-- AlterTable: 添加默认子贴外键
ALTER TABLE "threads" ADD COLUMN "default_subthread_id" TEXT;
CREATE UNIQUE INDEX "threads_default_subthread_id_key" ON "threads"("default_subthread_id");
ALTER TABLE "threads" ADD CONSTRAINT "threads_default_subthread_id_fkey" FOREIGN KEY ("default_subthread_id") REFERENCES "subthreads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: 填充现有主题帖的默认子贴
WITH first_subthreads AS (
  SELECT DISTINCT ON (thread_id)
    id as subthread_id,
    thread_id
  FROM subthreads
  WHERE deleted_at IS NULL
  ORDER BY thread_id, created_at ASC
)
UPDATE threads t
SET default_subthread_id = fs.subthread_id
FROM first_subthreads fs
WHERE t.id = fs.thread_id
  AND t.default_subthread_id IS NULL;
