-- 把旧三分类仅存于 Web 常量中的展示色搬入可编辑分类数据。
-- 只回填空值，保留管理员已经设置的颜色。
UPDATE "thread_category_definitions"
SET "color" = CASE "slug"
  WHEN 'DEDUCTION' THEN '#7B5D22'
  WHEN 'NATION' THEN '#4B527C'
  WHEN 'RPG' THEN '#704C65'
  ELSE "color"
END
WHERE "color" IS NULL
  AND "slug" IN ('DEDUCTION', 'NATION', 'RPG');
