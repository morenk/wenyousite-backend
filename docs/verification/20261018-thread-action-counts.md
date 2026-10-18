# 主题互动总数交付核验

- 实现提交：`da68203a494c6d0f6d377c23399390c2cee397f3`，基线 `08bbf5dbcd791270764fc2152fe9b61f683d7fa1`；独立任务分支 `codex/20261018-thread-action-counts`。
- API：`5.40.0-dev.20261018.1`；OpenAPI SHA-256：`2ec476d48879be46bfbb6f2bf762631300a1b89b9307298e610135b398b059de`。语义及消费者缺字段兼容见[互动总数契约](../thread-action-counts.md)。
- 2026-10-18 在 VPS 开发身份完成 `pnpm check`，退出 0：lint、类型、架构、OpenAPI 生成一致性及版本纪律、209 组 / 2,862 项 Jest、HTTP 安全、隔离工具、富文本、发布／下载、部署预检／运行、安全、文档检查和 Nest 构建均通过。单独定向 Jest 3 组 / 101 项通过。
- 本改动无权限写路径变更；以完整 `check` 加本次隔离 HTTP／数据库回归验证新增读模型，没有宣称运行所有 `check:full` 旅程。
- 新增只增索引迁移 `20261018090000_thread_action_count_indexes`，实际隔离实例确认两个索引存在；不回填或改写历史数据。正式部署创建索引时会锁定相应关系表写入，应由负责人按本次范围批准切换。

## 隔离验证

全部由本任务 checkout 的一次性 runner 创建 PostgreSQL、Redis、上传路径和随机用户，启动后核验真实进程身份；API 指向各轮随机 loopback 端口。禁用真实邮件／推送／对象存储，未连接公网业务接口，不对公网做自动写入。

| runId | 结果 | 清理 |
| --- | --- | --- |
| `e2e_bf3b8ce1f2a768cda16815a1` | 测试 helper 给无正文 DELETE 错误附带 `application/json`，Fastify 返回 400，与测试预期 404 不同；初次诊断过于简略 | runner 验证并清理，目录 `RaNhNb` 不存在 |
| `e2e_3a22434b8fcd66b5d780fdcb` | 补充受控诊断后确认同一 helper 错误；修正为仅有 JSON 正文时带 Content-Type | runner 验证并清理，目录 `AybwBg` 不存在 |
| `e2e_4b748d2302c92df5bac78a18` | `pnpm e2e:run --source --suite=thread-action-counts` 通过 | runner 输出 `resourcesVerified=true` / `resourcesCleaned=true`；目录 `XxRV0f` 不存在 |

成功轮：PostgreSQL 46383，cluster_name 绑定该 runId；Redis 43953，实例 `1792b043184eb3ce11db8a1f8dd2fd6f97afcf3c`；API `http://127.0.0.1:35295`，所有资源属于 `/tmp/wenyousite-e2e-XxRV0f`。

覆盖真实零值、HTTP 收藏／取消／移动目录、官方订阅／取消、重复操作、THREAD 与 USER 不重复计数、管理者自动通知不加人数、角色变化后保留的显式关系、注销关系保留但不计数、事务回滚、匿名正文缓存命中仍更新总数、私人关系不可操作、私帖／草稿／删除拒绝。没有统计用户列表或身份泄露。

首次完整检查还发现 posting-flow mock 未补新的聚合查询和新 Worktree 缺少固定音频运行依赖；已补 mock、按 `audio-runtime.lock.json` 逐文件 SHA-256 核验本机不可变依赖缓存后准备当前 Worktree，再重跑完整检查通过。官方下载曾遇到现有代理 SSL EOF；未改 TLS 验证或依赖版本，没有以跳过音频测试替代门禁。

## 交付边界

Mobile 和 Web 从上述已提交 SHA 同步；新字段 OpenAPI 可选且无 default，旧响应缺失不能作为 0。创建／更新响应沿用可选 DTO，消费者应在成功写入后刷新 GET 详情。Markdown、剪贴板和 Foundation 协议不变，仅共享 fixture 的 HTTP 版本元数据同步；无需 Foundation 发版。

未合并、未部署、未创建 Tag。后端切换前仍须 Web 兼容提交存在远端，并由负责人明确批准含索引迁移的部署。Auto-review 默认偏好已传递，但宿主实际策略为 `never`，工具无审批配置入口，不能宣称 `auto_review` 已设置或核验。

检查日志 SHA-256：
- 完整检查：`e7a8a533ddc5b4e6c53262eff1c54514bc1ae1949996668bb5e8018cd5a70c51`。
- 成功隔离回归：`0b509736ae002c0f341ba7a5ab5fcc6e11ef9745ff81e675365eaebe5184e147`。
