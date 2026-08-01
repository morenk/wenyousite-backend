-- 正文（kind=BODY）不占楼层号：清空存量 BODY 帖的 floor_number，避免与楼层唯一约束冲突
UPDATE "posts"
SET "floor_number" = NULL
WHERE "kind" = 'BODY' AND "floor_number" IS NOT NULL;
