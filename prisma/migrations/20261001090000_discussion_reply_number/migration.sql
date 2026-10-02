-- 含已删除记录的历史编号保持稳定；事务锁阻止回填期间并发插入。
BEGIN;
LOCK TABLE posts IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE posts ADD COLUMN reply_number INTEGER;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_post_id ORDER BY created_at, id)::INTEGER AS n
  FROM posts WHERE parent_post_id IS NOT NULL
)
UPDATE posts p SET reply_number = numbered.n FROM numbered WHERE p.id = numbered.id;
CREATE UNIQUE INDEX posts_parent_post_id_reply_number_key ON posts(parent_post_id, reply_number);
CREATE INDEX posts_reply_window_idx ON posts(parent_post_id, deleted_at, reply_number);
ALTER TABLE posts ADD CONSTRAINT posts_reply_number_positive CHECK (reply_number IS NULL OR reply_number > 0);
-- 兼容迁移后仍在短暂运行的旧进程和只提供旧字段的写入入口。
CREATE FUNCTION assign_post_reply_number() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_post_id IS NOT NULL AND NEW.reply_number IS NULL THEN
    PERFORM id FROM posts WHERE id = NEW.parent_post_id FOR UPDATE;
    SELECT COALESCE(MAX(reply_number), 0) + 1 INTO NEW.reply_number
      FROM posts WHERE parent_post_id = NEW.parent_post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER posts_assign_reply_number BEFORE INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION assign_post_reply_number();
COMMIT;
