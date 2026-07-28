-- 修复存量重复 sortOrder：按每个主题帖的帖子创建顺序从 0 开始重新编号
WITH numbered AS (
  SELECT id, thread_id,
    ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at, id) - 1 AS new_order
  FROM subthreads
  WHERE deleted_at IS NULL
)
UPDATE subthreads s SET sort_order = n.new_order
FROM numbered n WHERE s.id = n.id;

-- 为已删除子贴分配独立编号，避免冲突
WITH numbered AS (
  SELECT id, thread_id,
    ROW_NUMBER() OVER (PARTITION BY thread_id, deleted_at IS NULL ORDER BY created_at, id) + 10000 AS new_order
  FROM subthreads
  WHERE deleted_at IS NOT NULL
)
UPDATE subthreads s SET sort_order = n.new_order
FROM numbered n WHERE s.id = n.id;

-- 添加帖内排序唯一约束
ALTER TABLE subthreads ADD CONSTRAINT subthreads_thread_id_sort_order_key UNIQUE (thread_id, sort_order);
