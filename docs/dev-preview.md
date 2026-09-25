# 实时开发预览运行说明

预览是持续反馈环境，与一次性 E2E 隔离 runner 分开登记。源码修改与交付仍通过 Git，实际数据只留在 VPS 私有目录。不要部署、合并或替换正式服务来查看样式。

## 开发启动

已配置 E2E 只读二进制（参见 [E2E 隔离](e2e-isolation.md)）并生成 Prisma Client 后，在 Backend 任务 Worktree：

```bash
pnpm dev:preview start --session page-layout --web-port 43881
pnpm dev:preview status --session page-layout
pnpm dev:preview export --session page-layout
pnpm dev:preview stop --session page-layout
pnpm dev:preview resume --session page-layout
```

默认选择 PREVIEW_SNAPSHOT_ROOT/<北京时间当天日期>，未配置时为 ~/.local/state/wenyousite-preview-snapshots/<当天日期>。不存在、过期、哈希不符、权限错误立即停止；不会回落线上或自行申请管理员凭据。也可显式 --snapshot 指定目录。

启动后 stdout 只输出 JSON，consumerPath 是私有消费者描述的绝对路径。机器入口为 node --import tsx scripts/dev-preview/cli.ts，command/参数与上面相同；export 只有在两个运行身份端点验证成功后输出纯消费者 JSON。status 额外输出实际 sourceSha/sourceDigest/sourceDirty；源码摘要覆盖 src、prisma、开发工具和依赖声明，dirty=true 必须标注为未提交候选。Backend 源码改变后 stop/resume 才是新一轮运行；Web/Mobile 连续改样式不重启 Backend。

状态目录默认 ~/.local/state/wenyousite-preview，可通过 PREVIEW_STATE_ROOT 改到其他 0700 私有目录。每个批次固定创建它的 Backend Worktree；同名操作互斥，不接管其他 Worktree。所有服务仅监听 127.0.0.1，禁止 3000/3001/5432/6379。端口占用拒绝启动，不停止占用者。

Web/Mobile 消费 [已提交的 v1 协议](dev-preview-session.md)，只获得 consumer.json。后端与媒体端点每次验证实际 PG cluster_name、Redis 实例/归属；Backend 网关还核对实际 API 监听 socket 属于登记的进程组。业务请求缺少 X-Wenyou-Preview-Run 直接拒绝。SSH、ADB reverse 必须同端口，不改预签名 URL。Web refreshToken Cookie 由网关按 runId 命名，防止不同 loopback 端口的批次覆盖彼此会话。

## 媒体与邮件

每个批次使用独立目录运行仅开发依赖 s3rver 3.7.1，接入既有预签名、确认和图片 Worker。s3rver 自身未实现 SigV4 校验，预览网关使用官方 Smithy 签名器核对 canonical request、期限与同端口 Host，并拒绝匿名写入。凭据 S3RVER 仅为本机模拟 S3 固定标识，无线上权限；生产依赖不包含 s3rver。

历史图片原 URL 继续只读显示。后台需要原图时，只为快照登记 key 从精确 HTTPS 源域名下载到本地 S3；先固定 DNS 的公网 IPv4，禁止重定向，限制 32 MiB 与超时。未登记对象无法触发回源。DELETE 只删本地对象并登记 tombstone，防止删除后从历史源复活；不向历史源发出任何写入。

邮件处于 test JSON transport，额外写入本批次 mailbox/ 下的 0600 JSON；文件可能含验证码，只在 VPS 本地查看，不打印到任务日志或复制到 Windows。真实 SMTP、Firebase、Sentry 与线上存储凭据从未进入应用环境。快照净化移除所有 refresh/admin 会话、验证码、设备令牌、邀请与旧 outbox，取消待发送通知和未完成媒体任务。原账号密码哈希与内容关系保留。

## 停止、重置与恢复

stop 按 UID、随机 runId、进程组与启动时间停止全部登记进程，保留 PG/Redis/媒体和本地操作。resume 使用同一数据、端口及 runId，跨天不自动刷新。新快照只影响新建实例或显式 reset：

```bash
pnpm dev:preview reset --session page-layout --confirm page-layout
pnpm dev:preview stop --session page-layout
pnpm dev:preview cleanup --session page-layout --confirm page-layout
```

reset 在停止旧实例前先核验新快照；产生新 runId，消费者必须重新导出连接。cleanup 必须已停止/失败，只删除当前已登记目录；身份漂移时保留现场。普通启动失败停止本轮自有进程并保留私有日志；不是清理线上数据的入口。SIGKILL 后遗留进程可用同批次 stop 逐项核验回收。锁恢复采用独立原子 recovery 锁；recovery 本身异常遗留时拒绝猜测删除，核对原进程结束后再由本任务处理该确切文件。

## 管理入口启用与当天快照

以下命令必须在代码评审合并、管理入口独立启用后，由 wenyou-admin-vps 使用。开发身份不能执行真实源导出，本次实现不会修改 sudo、systemd 或已有备份任务。

管理配置只提供 root 所有的 0600 source.env，其中 DATABASE_URL 指向具有只读导出权限的来源；不传到 argv。--source-sha 必须是备份时点的精确部署源码 SHA。--output 是 root 私有快照暂存根，--publish-root 是预先创建的开发身份 0700 目录。

```bash
pnpm dev:preview:snapshot \
  --source-env /root/private/preview-source.env \
  --output /root/private/preview-snapshots \
  --publish-root /home/wenyou-dev/.local/state/wenyousite-preview-snapshots \
  --backup-root /var/backups/wenyousite/postgres-logical \
  --pg-bin /opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin \
  --source-sha <备份对应的40位SHA> \
  --media-origin https://<已审核的公开媒体域名>
```

顺序为：复用已校验的当天 preview snapshot → 选择当天最近的既有逻辑备份并核验 SHA sidecar 与 pg_restore TOC → 没有当天备份才使用只读 PG 导出快照。已有当天备份损坏时停止，不能无声跳过。既有备份只解析所选表的 COPY 数据以提取 migration 与历史媒体映射，不执行导出 SQL；新导出通过 pg_export_snapshot 将 dump、migration 和媒体映射绑定同一只读事务。时间使用固定捕获时点，跨午夜不会自相矛盾。

发布仅复制 database.dump、snapshot.json、media.json 到开发身份目录，并设置 0700/0600；原 root 备份和 source.env 权限不变。开发端再次校验哈希并在新独立 PG 恢复、检查 migration 后净化敏感会话。快照和源码版本不能混为一谈；不要把真实账号、密码、正文或 dump 交给客户端。

## 验证与交付

pnpm test:preview 覆盖协议 schema、日期、保留端口、坏快照、媒体域/IP、派生对象映射、互斥与死锁恢复；pnpm test:preview:integration 创建真实独立 PG/Redis 样本，覆盖密码保留、净化、API 身份、签名上传、Worker、收件箱、错误资源、端口冲突、停止恢复、重置与清理。完整交付执行 pnpm check 及高风险 pnpm check:full。

交互反馈只跑受影响检查并提供画面，视觉收敛后才执行完整交付门禁。pnpm exec tsx scripts/dev-preview/integration.ts --keep 可在同样隔离边界留一个 live-preview-acceptance 样本批次，Web 端口 43881；随机测试账号只写 VPS 本批次 sample-account.json。该样本只用于联验，不能冒称当天真实用户数据；验收结束必须 stop/cleanup，并按输出登记回收样本快照目录。
