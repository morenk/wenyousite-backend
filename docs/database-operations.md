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
cd /srv/wenyousite/wenyousite-backend
bash scripts/provision-data-security.sh
```

脚本只创建权限边界和带 `CHANGE_ME` 的模板，不生成或覆盖密码。需要由 VPS
本地生成内部随机口令时，紧接着执行：

```bash
bash scripts/generate-data-security-secrets.sh --apply
```

生成器只接受首次空模板，拒绝覆盖既有配置；它会迁移当前 `.env` 的应用设置、写入
九个独立 64 位十六进制口令和 Redis ACL hash，并把原 `.env` 收紧为 `0600`。
口令不会写到终端或日志。临时恢复清单位于
`/root/wenyousite-data-security-recovery.txt`（`0600 root:root`）；必须先通过 SSH
抄入离线密码管理器并确认，再删除该临时副本。RainS3 bucket/key/endpoint/region 和
`OPS_ALERT_TO` 仍保留占位符，必须由操作者直接填写。

最终配置文件及权限如下：

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

## 发布产物权限门禁

标准部署在构建前固定 `umask 022`。装配脚本会为复制的构建产物和应用文件补齐运行组读取、目录遍历权限，保留 root 所有权并禁止 group/world 写入；不改变源码 checkout 或 `/etc/wenyousite` 密钥权限。

新建及复用的 release 均在切换 `current` 前，以实际 `wenyousite-backend` 身份读取两个入口和 `BUILD_SHA`、加载 API/Worker 模块。检查使用空环境加 `NODE_ENV=test`，不启动应用或连接数据服务；失败保留当前指针和候选 release，不自动修改已有不可变 release 的权限。

2026-09-11 发布事故：治理为保护部署日志，在调用标准部署时设置了 `umask 077`，该设置同时影响构建，产生 root 所有的 `0700/0600` 产物。原装配脚本用 `cp -a` 保留权限，并仅以 root 加载模块，导致切换到 `5b766305e21d2a39bd53bb0c3aacc05fad81152f` 后 API/Worker 无法读取入口。治理通过标准装配脚本重新选择旧 release `0ee2c0de1d9c570e495e778be6661b074b7a4bef` 后恢复服务，公网健康正常，原楼层正文 hash 保持不变。本修复独立于 Markdown 功能，不涉及契约、依赖或数据库迁移。日志应在局部子 shell 中以 `umask 077` 创建为 `0600`，不让日志权限设置影响部署构建。

权限回归需管理身份运行 `pnpm test:deploy-release:integration`：仅使用 `/tmp` 临时产物和真实服务用户，覆盖调用者 `umask 077`、root 所有的 `0700/0600` 构建输入，以及复用产物不可读或模块加载失败时不切换。该测试不操作 systemd、数据库或活动 release。

## 常规运行与告警

systemd 定时器如下，时间均为 UTC：

| timer | 频率 |
| --- | --- |
| `wenyousite-redis-backup.timer` | 每 10 分钟；15 分钟未成功即告警 |
| `wenyousite-postgres-physical-backup.timer` | 每天 03:15，周日 full、其余 differential |
| `wenyousite-postgres-logical-backup.timer` | 每天 04:15 |
| `wenyousite-restic-maintenance.timer` | 每小时第 05/15/25/35/45/55 分钟重试；同一批准政策每天完成一次 forget、prune、check |
| `wenyousite-backup-health.timer` | 每 5 分钟检查时间戳、WAL、checksums、pgBackRest 与 AOF |
| `wenyousite-restore-drill.timer` | 每季度首日，隔离恢复并验证 2 小时 RTO |

查看状态：

```bash
systemctl list-timers 'wenyousite-*backup*' wenyousite-restic-maintenance.timer wenyousite-restore-drill.timer
journalctl -u wenyousite-backup-health.service --since '-1 hour' --no-pager
bash scripts/validate-running-data-security.sh
```

每个备份/维护/演练 unit 都通过 `OnFailure` 进入 SMTP 告警；同一 unit 一小时内最多发送一次。告警只包含 unit、主机、时间和受限 journal，不包含业务正文或凭据。备份成功时间戳位于 `/var/lib/wenyousite/backup-state`。

备份健康巡检会记录 `pgbackrest_info` 阶段的开始、结束、命令退出码和耗时；整轮通过时记录
`backup_health_success`，失败时记录单行 `backup_health_failure`。邮件冷却期间仍保留每轮
journal，因此排障应同时查看首次失败、后续失败与恢复成功记录，不能根据邮件数量判断失败次数。

pgBackRest 的顶层 `99/other` 只表示通用异常。失败日志中的 `diagnostics` 同时检查仓库级
状态，并按仓库编号提取错误类型、网络原因、HTTP 状态码、S3 错误码和 stderr 中的
pgBackRest 错误编号。例如 `HostConnectError` 配合 `timeout` 表示连接超时，HTTP `403`
配合 `SignatureDoesNotMatch` 指向签名鉴权问题。命令非零退出、空输出或异常 JSON 均判定失败，
并用 `output_state` 区分 `empty`、`invalid_json`、`invalid_shape` 与 `valid`。

错误文本只用于白名单字段提取；日志和邮件不回显原始 stdout/stderr、请求头、URL、路径、
S3 响应正文或未知错误文本。每条错误文本最多分析前 32768 个字符，超出时标记 `truncated`；
最多记录四个失败仓库及有界的错误码列表。原始命令输出只暂存在本轮私有临时目录，退出时清理。
诊断字段为空或标记截断时，需由管理入口进一步检查，不能把它解释为无错误。

### Redis 快照与分段日志

Redis 的 `rdb_saves` 在后台保存开始时递增，不能只靠“计数比调用前增加”判断加入的
已有 BGSAVE 是否完成。脚本区分本轮启动与加入已有任务，同时核对运行状态、最后保存结果
及 Redis `run_id`。本轮启动要求计数增加；加入此前已经运行的任务允许计数不变，但拒绝
已运行超过等待预算的旧任务。计数回退、实例重启、保存失败或没有新保存证据均不上传旧文件。
同一秒内完成的保存不依赖 `LASTSAVE` 增加；默认仍最多等待 60 秒。

只有 RDB 校验、拷贝、SHA 校验及真实异地备份都成功后才写 Redis 成功时间戳。
新时间戳额外记录保守的 `snapshot_epoch`，巡检以该恢复点年龄判断 15 分钟 RPO；上传耗时
不能通过刷新完成时间掩盖旧恢复点。升级期间旧格式暂按 `completed_epoch` 判断，下一次成功
备份自动迁移，无需修改旧时间戳。

Redis/逻辑备份和 restic 维护记录 `backup_operation` 总时长，以及 `backup_stage` 的
开始、完成、耗时和原退出码。阶段包括 BGSAVE 等待、校验、拷贝、校验和、共享锁等待、
远端备份、forget、prune、check。日志只描述脚本可观测的阶段，不能据此区分 restic 内部
DNS、上传或重试耗时。命令原始 stdout/stderr 只进入本轮 0700 临时目录中的 0600 文件，
退出时删除；不回显对象路径、请求头、签名 URL 或错误正文。机器审阅入口 stdout 仅为 JSON，
阶段日志写 stderr。失败和信号的退出码由退出清理保留。

### 维护优先级、重试与一致性检查

本实现依据 restic 0.16.4：backup 使用原生非排他锁，forget/prune/check 需要原生排他锁。
移除本地 flock 或给真实 check/prune 加 `--no-lock` 都不能解决安全并发。
本地恢复入口继续保留同一仓库互斥；备份在等仓库锁前持有共享“备份意向锁”，多个等待者
可并存，内核在实际持有进程退出后自动回收，不使用可能遗留的标记文件。

维护每个阶段单独获取仓库锁；已存在备份/恢复则立即延期。阶段运行中每 100ms 检查备份
意向，出现等待者即向整个维护子进程组发送 SIGINT，等待其退出、释放原生锁后才归还本地锁。
每阶段最多 540 秒，优雅退出最多 30 秒；测试可下调，不能上调。即使被中止的子进程返回 0，
也记为延期，不当成完成。如果强制终止或残留子进程无法正常退出，则失败并告警，可能残留
原生锁；脚本绝不自动 `unlock`、删除原生锁或绕过互斥。

定时器在 Redis 十分钟计划的中间重试，加入最多 30 秒抖动。各已完成阶段以批准文件摘要
保存每日检查点，下一轮继续未完成的阶段；只有三个阶段均完成才更新 `restic-maintenance.success`。
延期不刷新任何未完成阶段或整轮成功时间，五分钟巡检仍以 30 小时阈值报告维护逾期。

check 使用 restic 支持的 `--with-cache` 保留受保护的快照、索引和树元数据缓存，降低中止后
重试的远端读取量；仍执行完整结构检查和 pack 存在性检查，不跳过原生锁，不把缓存命中当作
检查完成。这是结构一致性检查，不等于每轮从远端重读全部数据；季度隔离恢复演练仍保留。
独立慢速 REST 仓库回归验证真实中止后的锁释放、缓存积累后完整完成，以及热缓存下缺失 pack
仍报错。线上目录列举或网络若持续慢到无法在备份间隙完成，缓存不能保证收敛；此时保留告警，
由管理入口评估仓库规模、网络和容量，不能延长 RPO 或伪造维护成功。

### 保留政策审阅与显式激活

**部署本版本不会启用历史删除。** 没有 root 管理的
`/etc/wenyousite/restic-retention-approval.json` 时，定时维护只执行 check，成功只更新
`restic-check.success`；不执行 forget/prune，也不更新整轮维护成功时间。因待审阅超过
30 小时触发的维护逾期告警保持有效，不通过禁用告警或伪造时间戳消除。

管理入口先生成新的私有清单（不要复用历史告警中的数量或过期清单）：

```bash
umask 077
bash scripts/restic-maintenance.sh --dry-run > /root/restic-retention-review.json
sha256sum /root/restic-retention-review.json
```

审阅入口只使用 `cat config` 和 `forget --dry-run --no-lock`，不创建原生锁、不删除快照、
不 prune、不更新成功时间。清单包含仓库 ID、政策版本、生成时间、两组保留/拟删除的完整
快照 ID 与时间，不包含原始路径、用户名或凭据。作用域固定为 `host=wenyousite`，精确单标签
`redis` 或 `postgres-logical`，按 `host,tags` 分组并保留最新快照起 35 天；其它主机、其它标签
及混合标签组均排除。restic 原有的未来时间/最老快照保护仍由原生命令决定。

负责人审阅保留组与拟删除组、恢复验证及清单 SHA 后，才可由管理入口执行：

```bash
bash scripts/restic-maintenance.sh --activate-reviewed /root/restic-retention-review.json \
  --confirm ENABLE_WENYOUSITE_RETENTION_V1
```

激活只接受 24 小时内、仓库身份一致的 root 私有实体清单，并原子写入 0600 批准文件；
激活命令本身不删除。**其后定时器可执行已批准范围内的真实删除**：历史快照必须出现在
审阅清单的保留或删除组中，后续仍按 35 天政策评估；清单生成后产生的新快照自动进入相同
政策。后来导入/发现且时间早于清单生成时间的未知历史快照会拒绝整轮 forget，要求重新审阅。
每轮重新生成候选，验证批准清单摘要及仓库 ID，再按明确 ID 分批 forget；prune 单独运行，
每轮最多重打包 256 MiB。中止可能只完成部分已批准删除，下一轮重新计算，不能回滚已删除快照。

迁移需通过标准部署安装更新后的维护 timer，并 `daemon-reload`；标准部署已包含此步骤。
无需新增 unit、数据库 migration 或修改 DNS。先部署并确认未启用删除，再生成/审阅/激活；
本次开发测试不会执行真实仓库的激活、forget 或 prune。

暂停删除时先由管理入口停止正在运行的维护，再将批准文件移至受保护归档位置；定时器随后
回到只检查模式。保留审阅清单、批准文件和部署记录。代码回退不得直接恢复旧版无激活门槛的
维护入口：先停用维护 timer/service，再按标准部署前滚修复或受控回退，独立确认维护策略后
才恢复 timer。备份 timer 与 15 分钟 RPO 不变。

### 回归验证

`pnpm test:redis-durability` 覆盖快照竞态、失败/超时/重启、信号退出码、锁等待与日志脱敏。
`pnpm test:backup-reliability:integration` 使用本轮 0700 临时 restic 仓库和自建慢速 REST
服务，以及 `e2e-resources.ts` 登记并验证的独立 PostgreSQL/Redis 进程，测试真实 Redis
主动/已有/失败 BGSAVE、实际 check/prune 中止与锁释放、稳定分组隔离、审阅零删除及显式激活。
需安装 restic，并配置只读 `E2E_PG_BIN`、`E2E_REDIS_BIN` 和需要的 `E2E_LIBRARY_PATH`；
缺少工具直接失败，不回退到线上配置。所有合成数据与自有进程在结束时核验并清理。

实现依据：[restic 0.16.4 保留与分组](https://restic.readthedocs.io/en/v0.16.4/060_forget.html)、
[check 缓存和原生锁](https://github.com/restic/restic/blob/v0.16.4/cmd/restic/cmd_check.go)、
[缓存类型](https://github.com/restic/restic/blob/v0.16.4/internal/cache/backend.go)、
[Redis 7.4.10 保存计数](https://github.com/redis/redis/blob/7.4.10/src/rdb.c)。

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
