# 子贴标签移除记录（2026-08-06）

状态：已完成，非现行客户端迁移说明。批次标识：`subthread-tags-removal-2026-08-06`。

当时的 2.0 契约删除 `/subthreads/:subthreadId/tags` 读写端点、子贴响应中的 `tags`，以及数据库表 `subthread_tags`、`subthread_tag_defs`。主题帖 `topicTags` 与 `/threads/:threadId/tags` 不受影响。

该变更当时没有旧客户端兼容窗口，要求 Web 和移动端先停止读写子贴标签再切换后端；回退需要同时恢复两张表、旧后端与旧客户端。当前客户端不得再依赖子贴标签能力。
