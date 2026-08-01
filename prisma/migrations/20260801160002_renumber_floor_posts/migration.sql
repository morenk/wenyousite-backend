-- 正文不占楼层号后，把存量主楼层按创建顺序重排为 1..N 连续编号（楼中楼保持 floor_number = NULL）
-- 先置空避免 (subthread_id, floor_number) 唯一约束冲突
UPDATE "posts"
SET "floor_number" = NULL
WHERE "kind" = 'FLOOR' AND "parent_post_id" IS NULL;

-- 按子贴内 created_at 顺序重新编号（原楼层号本就按创建顺序分配，created_at 等价于原顺序）
UPDATE "posts" p
SET "floor_number" = t.new_floor
FROM (
  SELECT id, row_number() OVER (PARTITION BY subthread_id ORDER BY created_at ASC, id ASC) AS new_floor
  FROM "posts"
  WHERE "kind" = 'FLOOR' AND "parent_post_id" IS NULL
) t
WHERE p.id = t.id;
