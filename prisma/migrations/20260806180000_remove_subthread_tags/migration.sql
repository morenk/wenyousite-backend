-- 子贴标签能力已从产品范围移除；先删除关联表，再删除标签定义表。
DROP TABLE "subthread_tags";
DROP TABLE "subthread_tag_defs";
