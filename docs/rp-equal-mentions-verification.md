# 平级角色提及验收记录

本次继续 PR44；仅契约候选，尚未完成运行实现与全量门禁，不可合并/部署。共享预览保持停止，自动业务写入只能使用登记的隔离实例。

契约切片已验证：TypeScript、Markdown6 固定语料 16 项、OpenAPI 从源导出（七写入DTO可选能力字段、读取header、候选query与稳定目标字段）、docs:check。全局Markdown仍5，新写默认关闭。机器版本5.35.0-dev.20261005.1；语义见[Markdown6协议](markdown-v6-role-mentions.md)。

后续必须补运行回归、旧读/写与缓存互不污染、导出源与展示分离、隔离数据权限/通知/并发和完整仓库门禁；未执行项不能当作通过。


运行补齐：八写入 DTO（包括 CreateThreadDto）已贯穿初始正文。相关回归14套212例、主题/发表2套191例、v6源码/候选/HTTP缓存与通知4套45例、lint/typecheck/docs:check 通过；完整 check:full 仍待执行。

独立隔离新旅程 `e2e_3104f1dd06b54330948f3a06` 通过并报告 resourcesCleaned=true；同账号同名角色/账号、改名、旧读/旧写、关闭/归档、跨主题拒绝、草稿/BODY/初始主题、目录、ZIP展示与源清单均验证。前两轮测试入口/用例问题（HTTP suite分类、合成用户名格式）失败，资源目录均确认已删除；不计为通过。

可复用的一次性入口：`scripts/e2e-runner.ts --role-mentions-v6 -- <consumer>` 显式启用隔离新写。`--suite=role-mentions` 和 `--full` 自动仅在各自隔离环境开启；生产配置默认仍false。共享预览未重开。消费者必须固定已提交入口SHA并核验manifest后才写入。
