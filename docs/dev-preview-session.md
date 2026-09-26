# 交互式开发预览协议 v1

本协议是私有开发工具接口，不属于业务 OpenAPI 或 Foundation。Web/Mobile 只消费已提交的此协议和 `consumer.json`，不能读取私有数据库配置。预览数据始终在 VPS；消费者描述不包含口令、用户内容或数据库凭据。

## CLI 与生命周期

`pnpm dev:preview start --session <批次名> --snapshot <目录> --web-port <端口>` 创建实例；再次启动同名实例复用。可省略 --snapshot 自动选择 PREVIEW_SNAPSHOT_ROOT 下当天目录；不存在则停止。快照按北京时间日期登记，首次创建只接受当天、SHA-256 校验成功的快照。运行实例跨天保持原数据。`resume` 是 `start` 的别名。
`pnpm dev:preview status --session <批次名>` 输出状态和 consumer 路径；`export` 输出 consumer JSON；`stop` 终止登记进程并保留磁盘数据；`reset --confirm <sessionId> --snapshot <目录>` 显式重建数据（仍保留会话编号，生成新 runId）；`cleanup --confirm <sessionId>` 仅移除已停止且身份匹配的登记目录。没有隐式全局清理。
批次名匹配 `[a-z][a-z0-9-]{2,47}`，由当前 owner Backend Worktree 控制；跨 owner 暂停与迁移只接受下文显式 runId 确认入口。每次启动持有主机全局 flock。启动失败停止本轮所有已登记子进程，保留数据和私有诊断。
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
Web 浏览器固化页面所属 runId 与每次 Web 启动独立产生的公开 webSessionId；业务请求携带 X-Wenyou-Preview-Run 与 X-Wenyou-Preview-Web，Web 代理先逐项核验再向 Backend 转发批次请求头。旧页面在换批次、恢复或更换 Web 任务后拒绝业务请求，客户端不配置另一 API 地址。webSessionId 与私有 Cookie token 分开；consumer 和身份 JSON 仍保持 v1，Web 响应额外携带公开 Web 生命周期头。Mobile 的 API 客户端只注入 X-Wenyou-Preview-Run（不发送 Web 生命周期头），在登录及所有写入前确保身份已校验，连接变化重新校验。
SSH 采用同端口转发 backend/media/web，Android 使用同端口 `adb reverse`；拒绝占用冲突，不悄悄换本地端口（签名 URL 含端口）。不允许 fallback 到线上 3000。identity 不属于公开业务路由，正式服务不注册它。

## 数据与外部副作用

PG/Redis 为本实例创建的独立进程；API/Worker 使用受限 `wenyousite_app` 角色。快照恢复后删除 refresh/admin 会话、验证码、设备推送登记、邀请凭据与旧 outbox，取消待处理外部任务；账号密码哈希和内容保留。新 JWT/pepper，独立 Redis；不读取仓库 .env。
仅运行 loopback s3rver 与独立媒体目录，既有 Worker 处理新增上传。历史对象只允许读取快照 manifest 登记的公开 HTTPS URL；域名精确匹配、禁止重定向/非公网解析/任意 URL，并限制大小。删除只作用于本地对象。
邮件使用本地私有文件收件箱，真实 SMTP、Firebase、Sentry 关闭。收件箱文件可能含验证码，只可在 VPS 私有目录查看，不输出到任务日志。
停止保留数据，恢复保留 Redis 持久数据和媒体；显式 reset/cleanup 才删除本批次资源。预览与一次性 E2E 登记独立，E2E reaper 不清理预览。

实现命令、快照受限发布与启动时源码摘要见 [开发预览运行说明](dev-preview.md)。机器入口 `node --import tsx scripts/dev-preview/cli.ts` 的 export/stdout 为纯 JSON；status 含 consumerPath、sourceSha、sourceDigest 与 sourceDirty。


## 单活动批次控制协议（兼容 v1）

消费者 JSON v1 不变。新建批次固定 Web `14310`、Backend `14311`、Media `14312`；内部数据库、Redis、API 仍动态分配。所有端口只监听 loopback。旧已停止批次必须执行 `rebind --session <name> --confirm <runId>` 后恢复，保持 runId、账号与业务数据；媒体签名使用本批次私有密钥，旧批次签名不能写入另一个批次。

机器入口仍为 `node --import tsx scripts/dev-preview/cli.ts`：

- `list` 不需要 session，跨已登记状态根及默认旧状态根列出全部批次。
- `start/resume --session <name> [--confirm <runId>]` 对已有批次在锁内核对可选 runId，防止 list 后同名 reset；在另一个批次有存活登记进程时拒绝。启动前检查全局记录与固定端口，不终止未知进程。
- `pause/stop --session <name> [--confirm <runId>]` 等价，精确核验后停止本批次，数据保留；只有创建者 Backend Worktree 可执行。管理入口必须带刚读取的 runId 确认，防止同名实例重置后误停。
- `rebind --session <name> --confirm <runId>` 只接受全部登记进程已停止的批次；固定端口迁移不重置数据。
- `status/export/reset/cleanup` 保留原接口与门禁。已登记 ready 但身份失效显示 unavailable，不能输出可用 consumer。

切换由管理入口执行：读取 `list`，按当前条目的 `worktree` 与 `stateRoot` 调用其 `pause`，确认 `processesAlive=false`，再按目标 owner 调用 `resume`。没有隐式抢占；暂停失败时不得启动目标。所有写操作竞争同一个 OS 用户的主机锁，PREVIEW_STATE_ROOT 不改变此锁。遗留进程或身份漂移优先阻断并保留诊断。

`list` stdout 示例（没有数据库口令、账号、令牌）：

```json
{"version":1,"kind":"wenyou-dev-preview-list","ports":{"web":14310,"backend":14311,"media":14312},"sessions":[{"sessionId":"page-layout","runId":"preview_aaaaaaaaaaaaaaaaaaaaaaaa","worktree":"/srv/wenyousite/worktrees/backend-page-layout","stateRoot":"/home/wenyou-dev/.local/state/wenyousite-preview","state":"paused","recordedState":"stopped","processesAlive":false,"verified":false,"ports":{"web":14310,"backend":14311,"media":14312},"consumerPath":"/home/wenyou-dev/.local/state/wenyousite-preview/page-layout/consumer.json"}]}
```

`state` 为 `ready|paused|unavailable|initializing|failed|invalid`，`recordedState` 保留登记状态。只有两个 identity 验证通过才 `ready, verified=true`；`paused` 表示登记 stopped 且无自有存活进程；`unavailable` 表示登记 ready 但已失活或部分进程存活、身份未通过。`processesAlive` 为 true/false，无法核验时为 null 并返回 `invalid`，不得按 false 处理。无有效登记的项目 `runId/worktree` 可为 null，`error` 仅为固定诊断代码。

### 重任务互斥

`node scripts/dev-heavy.mjs -- <command> [args...]` 是可直接复制已提交版本的独立 Node 入口，无 tsx、Prisma 或其他依赖。Backend 和 Web 使用完全相同的锁协议：通过 `os.userInfo().homedir` 解析固定 `~/.local/state/wenyousite-dev-control`，`flock -n heavy.lock` 拒绝并行重任务。持锁父进程、启动时间与 boot ID 写入 `heavy-owner.json`；仅实际 `/proc` 祖先链匹配才允许 check→build→E2E 嵌套，环境变量不能直接绕过。父进程异常退出但其受控命令仍存活时锁继续持有。手工调用底层编译器不属于受支持入口；标准 build/check/check:full 与隔离资源入口接入此门禁。


### 旧控制入口迁移

旧 Worktree 不支持全局锁时，不运行其旧 resume。由新版控制 Worktree 执行 `pause --session <name> --owner-worktree <登记owner绝对路径> --confirm <runId>`，精确核验并停止旧 owner 资源；这不会改变源码。随后显式 `adopt` 使用相同参数，只在全部停止后把控制归属迁移到当前新版 Worktree，并同步 ownership 记录。再执行 `rebind --session <name> --confirm <runId>` 与 `resume`。恢复运行源码为新 owner，状态记录其 SHA/摘要；数据和 runId 保留。归属漂移或仍存活时拒绝采用，原目录保留。

adopt 与 rebind 在任何元数据变更前检测旧媒体端口的本地对象。若存在对象、未完成上传或未知文件，返回 PREVIEW_MEDIA_REBIND_REQUIRES_MIGRATION 并保留原归属、原端口及数据，必须先独立迁移持久引用；不允许命令成功后才发现图片损坏。空媒体目录仅允许已知 CORS 配置文件，新批次和新上传统一使用固定端口。此预检是保守阻断，历史 HTTPS 媒体缓存也可能触发，不能以删对象绕过。

失败 stdout 不输出消费者连接；stderr 为 `{ "error": "PREVIEW_...", "detail": "固定无凭据提示" }`。媒体迁移阻断的 error 为 `PREVIEW_MEDIA_REBIND_REQUIRES_MIGRATION`，并发控制为 `PREVIEW_CONTROL_BUSY`，其他批次活动或不可核验为 `PREVIEW_ACTIVE_OR_UNVERIFIED`；管理入口按 error 处理，不输出私有诊断日志。
