# 数据库安全、备份与恢复

本文是公网开发环境 PostgreSQL 与 Redis 的安全、备份、恢复和演练手册。HTTP API
契约没有因此变化；这里描述的是数据平面和宿主机运行不变量。

## 服务目标与边界

| 对象 | 本机耐久性 | 异地恢复点 | 目标 |
| --- | --- | --- | --- |
| PostgreSQL | WAL、data checksums | pgBackRest 连续 WAL；周日 full、其余每日 differential | RPO 不超过 15 分钟 |
| PostgreSQL 辅助格式 | 每日 custom-format dump，`pg_restore --list` 和 SHA-256 校验 | restic 加密副本 | 独立于物理格式的恢复出口 |
| Redis | AOF `everysec`、`noeviction` | 每 10 分钟 RDB，`redis-check-rdb` 和 SHA-256 校验后由 restic 加密 | 异地 RPO 不超过 15 分钟 |
| 整体恢复 | 新 Docker volume 离线恢复和校验 | PostgreSQL 指定 UTC 时间；Redis 选择不晚于该时间的最新快照 | RTO 不超过 2 小时 |

pgBackRest 和 restic 的异地对象保留 35 天；本机辅助 dump/RDB 只保留 7 天，不能当作异地备份。季度演练会创建两个专用候选卷，完成 `pg_amcheck`、RDB 校验和应用语义清理后删除候选，不触碰活动卷。

公网部署仅把 5432/6379 映射到 `127.0.0.1`。PostgreSQL 使用 SCRAM，只有容器内 OS `postgres` 可以通过 Unix socket peer 进入无密码集群管理角色；生产 HBA 禁止 `trust`。Redis 关闭 `default` 用户并使用独立 ACL 角色。

## 最小权限角色

| 角色 | 用途 | 权限 |
| --- | --- | --- |
| `wenyousite_owner` | Prisma migration | 数据库/schema owner；没有 superuser、createdb、createrole、replication 或 bypassrls |
| `wenyousite_app` | API 与图片 Worker | 业务 schema 的 DML、sequence 与 function；没有 DDL/集群权限 |
| `wenyousite_backup` | 逻辑导出 | 只读数据与 sequence |
| `wenyousite_monitor` | 可观测性 | PostgreSQL `pg_monitor` |
| `postgres` | 本机集群管理 | superuser；无密码，只允许容器 OS `postgres` peer 登录 |

Redis 的 `wenyousite_app` 可以执行业务、缓存和 BullMQ 命令，但明确拒绝 ACL、CONFIG、FLUSH、SAVE、SHUTDOWN 等管理命令；`wenyousite_ops` 只供 root 运维脚本；`wenyousite_health` 只能 PING。运行服务拿不到数据库 owner、Redis ops/health、pgBackRest 或 restic 凭据；PostgreSQL 与 Redis 容器也只挂载各自必需的密钥文件，不能读取对方凭据。

## 首次配置

首次配置需要下列外部输入，仓库不会代填或打印：

- 新建的 RainS3 私有桶、区域、HTTPS endpoint；
- 只允许访问该桶/前缀的独立 AccessKey；
- pgBackRest 仓库加密口令和 restic 仓库口令；
- PostgreSQL 四个独立 64 位十六进制密码；
- Redis app/ops/health 三个独立 64 位十六进制密码及其 SHA-256；
- SMTP 用户、密码、发件地址和告警收件地址；
- 以上材料在离线密码管理器中的副本。

RainS3 若不提供对象版本控制或 Object Lock，仍可启用这套方案，但被盗的删除权限可能同时删除历史备份。该剩余风险已经被明确接受；因此 AccessKey 必须专用、最小权限，且离线保存恢复口令。不要复用媒体公开桶的密钥。

先安装由系统安全更新维护的 restic，再创建目录与专用用户：

```bash
apt-get update
apt-get install restic
cd /root/wenyousite/wenyousite-backend
bash scripts/provision-data-security.sh
```

脚本只创建权限边界和带 `CHANGE_ME` 的模板，不生成或覆盖密码。按输出的实际 GID 更新 `/etc/wenyousite/compose.env`，并完成以下文件：

```text
/etc/wenyousite/backend.env                 root:wenyousite-backend 0640
/etc/wenyousite/migration.env               root:wenyousite-migrator 0640
/etc/wenyousite/compose.env                 root:wenyousite-secrets 0640
/etc/wenyousite/alerts.env                  root:root 0600
/etc/wenyousite/restic.env                  root:root 0600
/etc/wenyousite/restic-password             root:root 0600
/etc/wenyousite/secrets/*                   root:wenyousite-secrets 0640
```

不可变 release 根目录使用 `root:wenyousite-runtime 0750`。API/Worker 与 migrator 都只有该组的只读遍历权限；migrator 不属于 `wenyousite-backend` 私有组，因此不能读取 `backend.env`。

`backend.env` 应从当前被 Git 忽略的 `.env` 迁移全部应用设置，再合并 `ops/secrets/backend-security.env.example`；它不得包含 `DIRECT_DATABASE_URL`。owner URL 只放在 `migration.env`。Redis ACL 文件只存密码 SHA-256，明文分别放在 `backend.env`、`redis-ops-password`、`redis-health-password` 和离线密码库。

`database-roles.env` 是 PostgreSQL 四个角色密码的主机事实源；把其中 owner 与 backup 的同一 64 位值分别写入 `postgres-owner-password` 和 `postgres-backup-password`。Compose 只将这两个专用文件挂入 PostgreSQL，不把整份角色文件或密码值放进容器配置环境。

`redis-users.acl` 只能包含三条专用用户规则和一条关闭 default 的规则，不能写注释；把三个 `SHA256_*` token 替换成对应明文密码的 SHA-256（不带 `>`）。明文仍只保存在前述专用文件、`backend.env` 与离线密码库。

完成后先运行只读门禁：

```bash
bash scripts/validate-production-security.sh
```

该门禁检查文件 owner/mode、角色名、密码隔离与一致性、HBA、ACL hash、TLS S3、仓库加密、35 天保留以及 SMTP 完整性，不输出凭据。确认 RainS3 前缀全新时执行：

```bash
bash scripts/activate-data-security.sh --apply --initialize-restic
```

若 restic 仓库已经初始化，省略 `--initialize-restic`。激活顺序固定为：质量门禁 → 旧实例逻辑/RDB 异地备份 → Redis AOF 完成 → PostgreSQL 角色收敛 → 安全 Compose → pgBackRest stanza/full 备份 → 离线启用 data checksums → 新 checksums 基线 full 备份 → 运行验证 → 首次两小时 RTO 恢复演练 → 写入激活标记 → 标准不可变部署。任一步失败都会停止扩大变更；不会删除旧卷。

## 常规运行与告警

systemd 定时器如下，时间均为 UTC：

| timer | 频率 |
| --- | --- |
| `wenyousite-redis-backup.timer` | 每 10 分钟；15 分钟未成功即告警 |
| `wenyousite-postgres-physical-backup.timer` | 每天 03:15，周日 full、其余 differential |
| `wenyousite-postgres-logical-backup.timer` | 每天 04:15 |
| `wenyousite-restic-maintenance.timer` | 每天 05:15，35 天 expire/prune 和仓库 check |
| `wenyousite-backup-health.timer` | 每 5 分钟检查时间戳、WAL、checksums、pgBackRest 与 AOF |
| `wenyousite-restore-drill.timer` | 每季度首日，隔离恢复并验证 2 小时 RTO |

查看状态：

```bash
systemctl list-timers 'wenyousite-*backup*' wenyousite-restic-maintenance.timer wenyousite-restore-drill.timer
journalctl -u wenyousite-backup-health.service --since '-1 hour' --no-pager
bash scripts/validate-running-data-security.sh
```

每个备份/维护/演练 unit 都通过 `OnFailure` 进入 SMTP 告警；同一 unit 一小时内最多发送一次。告警只包含 unit、主机、时间和受限 journal，不包含业务正文或凭据。备份成功时间戳位于 `/var/lib/wenyousite/backup-state`。

## 指定时间恢复

恢复准备永远创建新卷，示例目标必须为 UTC：

```bash
bash scripts/restore-prepare.sh --target 2026-08-26T02:30:00Z
```

脚本从 pgBackRest 选取可覆盖目标时间的 backup/WAL，在新 PostgreSQL 卷恢复并 promote，然后运行未完成 migration 检查与 `pg_amcheck`。Redis 从 restic 选择 `snapshot.time <= target` 的最新 RDB，校验 SHA/RDB，只保留 `bull:*` 队列键并清除所有可重建派生键。两个候选都干净停机后，manifest 才成为 `validated`。当前 Compose、容器和活动卷不变。

复核输出中的目标、卷名与 `/var/lib/wenyousite/restore-candidates/<candidate>.env`。确认切换时使用双重显式参数：

```bash
bash scripts/restore-activate.sh \
  --candidate 20260826t023000z_0123abcd \
  --confirm ACTIVATE_WENYOUSITE_RESTORE
```

切换前会再生成一组异地备份并停止 API/Worker；随后只改 `compose.env` 中两个活动卷，执行 migration，启动非 root 服务并检查本机 API。旧卷及 rollback manifest 始终保留。若切换失败，应用保持停止，不自动来回切换；先保全日志与两个卷，再决定前滚修复或按 rollback manifest 人工切回。成功切换后也不要立即删除旧卷。

不需要的、从未激活的候选可显式删除：

```bash
bash scripts/restore-discard.sh \
  --candidate 20260826t023000z_0123abcd \
  --confirm DELETE_RESTORE_CANDIDATE
```

删除入口会核对 manifest、volume label、活动卷和容器挂载；`activated` 候选不可由它删除。

## 手工验证

按需手工触发但不要与部署/恢复并行：

```bash
systemctl start wenyousite-redis-backup.service
systemctl start wenyousite-postgres-physical-backup.service
systemctl start wenyousite-postgres-logical-backup.service
systemctl start wenyousite-restic-maintenance.service
systemctl start wenyousite-restore-drill.service
```

每次凭据轮换都要同步更新 URL、角色密码、Redis ACL hash 与离线密码库，然后先运行静态门禁。数据库或 Redis 密码轮换应作为停写的独立运维操作，完成后执行运行验证和一次异地备份；不能只改一侧配置后重启。

实现依据：[PostgreSQL 连续归档与 PITR](https://www.postgresql.org/docs/17/continuous-archiving.html)、[pgBackRest 用户指南](https://pgbackrest.org/user-guide.html)、[restic S3 仓库](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)。
