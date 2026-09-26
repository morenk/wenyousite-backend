# 实时开发预览运行说明

预览是持续反馈环境，与一次性 E2E 隔离 runner 分开登记。源码修改与交付仍通过 Git，实际数据只留在 VPS 私有目录。不要部署、合并或替换正式服务来查看样式。

## 开发启动

已配置 E2E 只读二进制（参见 [E2E 隔离](e2e-isolation.md)）并生成 Prisma Client 后，在 Backend 任务 Worktree：

```bash
pnpm dev:preview start --session page-layout --web-port 4310
pnpm dev:preview status --session page-layout
pnpm dev:preview export --session page-layout
pnpm dev:preview stop --session page-layout
pnpm dev:preview resume --session page-layout
```

默认选择 PREVIEW_SNAPSHOT_ROOT/<北京时间当天日期>，未配置时为 ~/.local/state/wenyousite-preview-snapshots/<当天日期>。不存在、过期、哈希不符、权限错误立即停止；不会回落线上或自行申请管理员凭据。也可显式 --snapshot 指定目录。

启动后 stdout 只输出 JSON，consumerPath 是私有消费者描述的绝对路径。机器入口为 node --import tsx scripts/dev-preview/cli.ts，command/参数与上面相同；export 只有在两个运行身份端点验证成功后输出纯消费者 JSON。status 额外输出实际 sourceSha/sourceDigest/sourceDirty；源码摘要覆盖 src、prisma、开发工具和依赖声明，dirty=true 必须标注为未提交候选。Backend 源码改变后 stop/resume 才是新一轮运行；Web/Mobile 连续改样式不重启 Backend。

状态目录默认 ~/.local/state/wenyousite-preview，可通过 PREVIEW_STATE_ROOT 改到其他 0700 私有目录。每个批次固定创建它的 Backend Worktree；全局操作互斥，最多一个活动批次；旧归属只接受显式 runId 确认的 pause/adopt，不隐式接管其他 Worktree。所有服务仅监听 127.0.0.1，禁止 3000/3001/5432/6379。预览 PostgreSQL 仅启用 TCP（Unix socket 关闭），与 Prisma/恢复工具的显式 loopback 连接一致，较长的状态根或批次名不会触发 Unix socket 路径上限。端口占用拒绝启动，不停止占用者。

Web/Mobile 消费 [已提交的 v1 协议](dev-preview-session.md)，只获得 consumer.json。后端与媒体端点每次验证实际 PG cluster_name、Redis 实例/归属；Backend 网关还核对实际 API 监听 socket 属于登记的进程组。业务请求缺少 X-Wenyou-Preview-Run 直接拒绝。SSH、ADB reverse 必须同端口，不改预签名 URL。Web refreshToken Cookie 由网关按 runId 命名，防止不同 loopback 端口的批次覆盖彼此会话。

## 媒体与邮件

每个批次使用独立目录运行仅开发依赖 s3rver 3.7.1，接入既有预签名、确认和图片 Worker。s3rver 自身未实现 SigV4 校验，预览网关使用官方 Smithy 签名器核对 canonical request、期限与同端口 Host，并拒绝匿名写入。accessKeyId S3RVER 仅为本机模拟 S3 固定标识，签名 secret 每批次独立生成，均无线上权限；生产依赖不包含 s3rver。

历史图片原 URL 继续只读显示。后台需要原图时，只为快照登记 key 从精确 HTTPS 源域名下载到本地 S3；先固定 DNS 的公网 IPv4，禁止重定向，限制 32 MiB 与超时。未登记对象无法触发回源。DELETE 只删本地对象并登记 tombstone，防止删除后从历史源复活；不向历史源发出任何写入。

邮件处于 test JSON transport，额外写入本批次 mailbox/ 下的 0600 JSON；文件可能含验证码，只在 VPS 本地查看，不打印到任务日志或复制到 Windows。真实 SMTP、Firebase、Sentry 与线上存储凭据从未进入应用环境。快照净化移除所有 refresh/admin 会话、验证码、设备令牌、邀请与旧 outbox，取消待发送通知和未完成媒体任务。原账号密码哈希与内容关系保留。

## 停止、重置与恢复

stop 按 UID、随机 runId、进程组与启动时间停止全部登记进程，保留 PG/Redis/媒体和本地操作。resume 使用同一数据、端口及 runId，跨天不自动刷新。新快照只影响新建实例或显式 reset：

```bash
pnpm dev:preview reset --session page-layout --confirm page-layout
pnpm dev:preview stop --session page-layout
pnpm dev:preview cleanup --session page-layout --confirm page-layout
```

reset 在停止旧实例前先核验新快照；产生新 runId，消费者必须重新导出连接。cleanup 必须已停止/失败，只删除当前已登记目录；身份漂移时保留现场。普通启动失败停止本轮自有进程并保留私有日志；不是清理线上数据的入口。SIGKILL 后遗留进程可用同批次 stop 逐项核验回收。主机 flock 随持锁进程退出自动释放；随后仍须逐项核验登记进程与启动 epoch，锁释放不表示遗留资源已停止。

## 管理入口启用与当天快照

以下命令必须在代码评审合并、管理入口独立启用后，由 wenyou-admin-vps 使用有效 UID 0 执行。开发身份不能执行真实源导出，本次实现不会修改 sudo、systemd 或已有备份任务。

### 可信运行目录与版本预检

管理入口从固定的已审核提交准备 root 所有、开发身份不可写的代码、Node、依赖和已生成 Prisma Client；父目录及依赖的符号链接目标也必须受管理身份控制。禁止以 root 直接执行开发 Worktree 或开发身份可写的 node_modules。运行前记录入口提交和依赖锁文件校验值，使用清洁环境，不继承 NODE_OPTIONS、NODE_PATH 或应用连接配置。只读备份检查不等于已授权导出或发布快照。

先根据备份台账、源服务版本和可信 pg_restore --list 的归档头核对 PostgreSQL 源版本及导出工具版本；SHA sidecar 通过只说明文件校验一致，不证明恢复工具兼容。导入工具与独立恢复实例须使用与源库及该备份导出工具相匹配的 PostgreSQL 主版本，不沿用样本 E2E 工具的固定版本。来源为 PostgreSQL 17 且备份由 17 导出时，使用 17 的 pg_restore、initdb、postgres 及配套动态库；如需新导出，pg_dump 也使用对应版本。若源版本与导出工具主版本不同，先单独评审兼容性，不直接恢复。

例如归档头 1.16 不能交给现有 PostgreSQL 16 pg_restore；遇到 unsupported version 必须停止并准备匹配工具，不能修改 dump 头、重命名备份或回退到旧工具。管理侧 --pg-bin 与开发侧 E2E_PG_BIN 都要核对，不能只升级解析工具却仍用旧 postgres 创建实例；E2E_LIBRARY_PATH 也随该工具套件配置。安装工具是独立启用步骤，不因此启动或重启正式数据库。

以下只读模板须先替换为已核验的绝对路径；归档目录清单留在 VPS 管理私有文件中，不输出业务数据：

```bash
set -euo pipefail
umask 077
PREVIEW_PG_BIN='<匹配主版本的可信 PostgreSQL bin 目录>'
PREVIEW_PG_LIB='<该套件所需的可信动态库目录>'
PREVIEW_DUMP='<当天已核验逻辑备份的绝对路径>'
for tool in pg_dump pg_restore initdb postgres; do
  LD_LIBRARY_PATH="$PREVIEW_PG_LIB" "$PREVIEW_PG_BIN/$tool" --version
done
LD_LIBRARY_PATH="$PREVIEW_PG_LIB" "$PREVIEW_PG_BIN/pg_restore" \
  --list "$PREVIEW_DUMP" > /root/private/preview-dump.toc
```

实际代码没有 PostgreSQL 16 路径硬编码：管理入口使用 --pg-bin，恢复进程使用 E2E_PG_BIN。两侧都必须在首次真实数据启用前完成上述版本核验。

### 仅导入已有备份

--backup-root 必须是 root 所有的 0700 真实目录，dump 与 .sha256 为 root 私有普通文件。工具只选择文件名为 wenyousite_postgres_YYYYMMDDTHHMMSSZ.dump、按北京时间属于当天的最新备份；sidecar 校验后执行 pg_restore --list。较早日期的备份不直接接受，也不得改名伪造当天来源。

--source-sha 必须来自所选备份时点的精确部署证据。将备份文件名、捕获时间、SHA-256、归档头版本、迁移版本，与部署 revision/BUILD_SHA 及覆盖捕获时点的启停或部署记录绑定，证明该时点没有版本切换；当前 Git HEAD 或当前 BUILD_SHA 单独不能证明历史时点。该绑定由管理入口调用方审核：工具只验证 40 位 SHA 格式并记录参数，不从 dump 或校验 sidecar 推导源码 SHA。缺少证据时停止。当天 preview snapshot 已存在时会核验并复用其原 metadata，不会用新传入参数改写来源。

严格仅导入时，预先由管理身份准备一个 root 所有、0600、为空且不含 DATABASE_URL 的占位文件，例如 /root/private/preview-import-only.env，并把它传给 --source-env。不要传入生产应用环境文件。没有当天备份时，入口读取占位文件后因缺少 DATABASE_URL 停止，不会连接来源数据库；当天备份校验或工具版本失败也直接停止。--output 是 root 所有的 0700 私有快照根；--publish-root 是预先创建、开发身份所有且为 0700 的真实目录。

```bash
cd '<root所有且开发身份不可写的已审核入口目录>'
PREVIEW_NODE='<可信Node二进制的绝对路径>'
env -i HOME=/root PATH=/usr/bin:/bin E2E_LIBRARY_PATH="$PREVIEW_PG_LIB" \
  "$PREVIEW_NODE" --import tsx scripts/dev-preview/cli.ts snapshot \
  --source-env /root/private/preview-import-only.env \
  --output /root/private/preview-snapshots \
  --publish-root /home/wenyou-dev/.local/state/wenyousite-preview-snapshots \
  --backup-root /var/backups/wenyousite/postgres-logical \
  --pg-bin "$PREVIEW_PG_BIN" \
  --source-sha '<备份时点部署证据对应的40位SHA>' \
  --media-origin 'https://<已审核的公开媒体域名>'
```

### 获准按需只读导出时

只有另行启用只读导出能力后，才将 --source-env 改为 root 所有的 0600 source.env，其中 DATABASE_URL 为已核验、可连通来源的只读导出账号；不传到 argv，不交给开发身份。即使已有生产应用配置，也不得拿具备业务写权限的应用账号替代只读导出配置。

入口顺序为：复用已校验的当天 preview snapshot → 选择当天最近的既有逻辑备份并核验 SHA sidecar 与 pg_restore TOC → 没有当天备份才使用只读 PG 导出快照。已有当天备份损坏时停止，不能无声跳过。既有备份只解析所选表的 COPY 数据以提取 migration 与历史媒体映射，不执行导出 SQL；新导出通过 pg_export_snapshot 将 dump、migration 和媒体映射绑定同一只读事务。时间使用固定捕获时点，跨午夜不会自相矛盾。

发布仅复制 database.dump、snapshot.json、media.json 到开发身份目录，并设置 0700/0600；原 root 备份和 source.env 权限不变。开发端使用已核验的同版本工具，再次校验哈希，在新独立 PG 恢复并核对 migration 后迁移和净化敏感会话。确认 status 的 verified=true、来源时间/SHA 正确并完成净化核验后再接入消费者；不覆盖或隐式重置仍在运行的样本批次。快照和运行源码版本分别记录；不要把真实账号、密码、正文或 dump 交给客户端。

## 验证与交付

pnpm test:preview 覆盖协议 schema、日期、保留端口、坏快照、媒体域/IP、派生对象映射、互斥与死锁恢复；pnpm test:preview:integration 创建真实独立 PG/Redis 样本，覆盖密码保留、净化、API 身份、签名上传、Worker、收件箱、错误资源、端口冲突、停止恢复、重置与清理。完整交付执行 pnpm check 及高风险 pnpm check:full。

交互反馈只跑受影响检查并提供画面，视觉收敛后才执行完整交付门禁。pnpm exec tsx scripts/dev-preview/integration.ts --keep 可在同样隔离边界留一个 live-preview-acceptance 样本批次，Web 端口 4310；随机测试账号只写 VPS 本批次 sample-account.json。该样本只用于联验，不能冒称当天真实用户数据；验收结束必须 stop/cleanup，并按输出登记回收样本快照目录。

单活动列表、固定端口、旧归属 adopt 与重任务门禁见 [控制协议](dev-preview-session.md#单活动批次控制协议兼容-v1)。标准 build/check/check:full 与 withResources 隔离入口自动使用主机重任务锁；冲突退出后等待当前任务完成，不改端口或绕过入口。

跨端管理入口联调需要两个新批次时，可先运行 `pnpm test:preview:integration --snapshot-only`。它只用本轮独立 PostgreSQL/Redis 创建随机账号与样本快照，源资源验证并清理后输出 `snapshotPath/snapshotRoot`，不启动预览、不占 431x、不消费真实快照。随机账号只留在 VPS `snapshotRoot/sample-account.json`，不得输出口令或复制到 Windows。随后两个任务批次均以同一已校验快照路径启动，分别创建独立数据库；验收后按 runId stop/cleanup，再核验 snapshotRoot/ownership.json 的路径、UID、Worktree 和 kind 后回收该确切样本根。此入口保留样本供联调，不代表真实用户数据验收。
