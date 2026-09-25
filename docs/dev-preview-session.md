# 交互式开发预览协议 v1

本协议是私有开发工具接口，不属于业务 OpenAPI 或 Foundation。Web/Mobile 只消费已提交的此协议和 `consumer.json`，不能读取私有数据库配置。预览数据始终在 VPS；消费者描述不包含口令、用户内容或数据库凭据。

## CLI 与生命周期

`pnpm dev:preview start --session <批次名> --snapshot <目录> --web-port <端口>` 创建实例；再次启动同名实例复用。可省略 --snapshot 自动选择 PREVIEW_SNAPSHOT_ROOT 下当天目录；不存在则停止。快照按北京时间日期登记，首次创建只接受当天、SHA-256 校验成功的快照。运行实例跨天保持原数据。`resume` 是 `start` 的别名。
`pnpm dev:preview status --session <批次名>` 输出状态和 consumer 路径；`export` 输出 consumer JSON；`stop` 终止登记进程并保留磁盘数据；`reset --confirm <sessionId> --snapshot <目录>` 显式重建数据（仍保留会话编号，生成新 runId）；`cleanup --confirm <sessionId>` 仅移除已停止且身份匹配的登记目录。没有隐式全局清理。
批次名匹配 `[a-z][a-z0-9-]{2,47}`，只在创建它的 Backend Worktree 中控制；每次启动持有原子操作锁。启动失败停止本轮所有已登记子进程，保留数据和私有诊断。
管理身份在单独审核启用后运行 `dev:preview:snapshot --source-env <root私有文件> --output <受限目录> --source-sha <40位SHA> --media-origin <https域名> --pg-bin <二进制目录> --publish-root <开发私有目录> [--backup-root <逻辑备份目录>]`，优先复用当天校验过的逻辑备份，没有才只读导出 PG custom archive，提取 migration 版本与允许读取的历史对象映射；相同日期只复用校验成功的快照。开发身份不获得源凭据。

## 消费者描述

JSON schema 在 `contracts/dev-preview-session.schema.json`。字段：
- `version: 1`、`kind: "wenyou-dev-preview"`、`sessionId`（批次名）、`runId`（`preview_` + 24位hex）、`state: "ready"`。
- `snapshot: { capturedAt, businessDate, sha256, sourceSha, migrationVersion }`。
- `source: { backendSha, worktree }`；消费者另外记录自身 SHA/脏源码摘要，不把 Backend SHA 当成自身版本。
- `backend: { port, origin, apiBase, identityUrl }` 与 `media: { port, origin, identityUrl }`，均固定 `http://127.0.0.1:<port>`；`apiBase` 为 origin + `/api/v1`，identityUrl 为 origin + `/__preview/identity`。
- `web: { port, origin }` 指定同批次 Web 的 loopback 端口。
- `identity: { header: "X-Wenyou-Preview-Run", value: runId }`；`ownership: { uid, resourceId }`，resourceId 等于 runId。不输出服务器上的资源目录或数据库信息。

## 必须执行的运行身份核验

启动消费者前先通过实际将使用的连接分别 GET backend/media 的 `/__preview/identity`，必须禁用重定向。响应状态 200、`Content-Type: application/json`，body 恰为：
`{ version: 1, kind: "wenyou-dev-preview", sessionId, runId, role: "backend" | "media", resourceId: runId, snapshotSha256 }`。
同一响应头 `X-Wenyou-Preview-Run` 必须等于 runId，body 的 sessionId、runId、resourceId、snapshotSha256 必须与消费者描述一致。后端启动前已核验真实 PostgreSQL cluster_name、Redis 实例及归属标记；媒体进程由同一登记管理，使用独立目录。
所有后端业务请求必须发送 `X-Wenyou-Preview-Run: <runId>`；缺少或错误返回 409，不执行业务请求。业务响应也携带该头。媒体预签名 URL 保持原 URL，上传无需另加自定义头（避免改变签名）；上传前必须核验 media identity。
Web 代理在服务端执行身份核验并注入请求头，客户端不配置另一 API 地址。Mobile 的 API 客户端注入此头并在登录及所有写入前确保身份已校验，连接变化重新校验。
SSH 采用同端口转发 backend/media/web，Android 使用同端口 `adb reverse`；拒绝占用冲突，不悄悄换本地端口（签名 URL 含端口）。不允许 fallback 到线上 3000。identity 不属于公开业务路由，正式服务不注册它。

## 数据与外部副作用

PG/Redis 为本实例创建的独立进程；API/Worker 使用受限 `wenyousite_app` 角色。快照恢复后删除 refresh/admin 会话、验证码、设备推送登记、邀请凭据与旧 outbox，取消待处理外部任务；账号密码哈希和内容保留。新 JWT/pepper，独立 Redis；不读取仓库 .env。
仅运行 loopback s3rver 与独立媒体目录，既有 Worker 处理新增上传。历史对象只允许读取快照 manifest 登记的公开 HTTPS URL；域名精确匹配、禁止重定向/非公网解析/任意 URL，并限制大小。删除只作用于本地对象。
邮件使用本地私有文件收件箱，真实 SMTP、Firebase、Sentry 关闭。收件箱文件可能含验证码，只可在 VPS 私有目录查看，不输出到任务日志。
停止保留数据，恢复保留 Redis 持久数据和媒体；显式 reset/cleanup 才删除本批次资源。预览与一次性 E2E 登记独立，E2E reaper 不清理预览。

实现命令、快照受限发布与启动时源码摘要见 [开发预览运行说明](dev-preview.md)。机器入口 `node --import tsx scripts/dev-preview/cli.ts` 的 export/stdout 为纯 JSON；status 含 consumerPath、sourceSha、sourceDigest 与 sourceDirty。
