# E2E 数据隔离与历史测试内容清理

公网环境承载需要保留的用户内容与审计数据。所有自动化测试写入必须使用独立 PostgreSQL 进程、Redis 进程和本次上传目录；loopback 地址、测试库名、Redis DB 编号或专用测试账号均不能证明隔离。公网只读验收，不再提供定向写入例外。

## webe2e 历史清理

此入口仅处理固定 ID `cmtt21ub700007qfeleo3j76y` 与 username `webe2e` 的历史主题及其关联，保留账号、钱包和现有审计。旧 `pnpm test:cleanup` / `scripts/cleanup-testuser.ts` 始终拒绝执行，不再删除 `testuser`，也不接受替换用户名。

治理管理入口显式注入 `CLEANUP_DATABASE_URL` 与 `CLEANUP_REDIS_URL`，不得把凭据放在命令行、聊天、Git 或仓库 `.env`。使用已提交工具，以 root 私有目录保存所有操作材料。

1. 默认 dry-run：`pnpm exec tsx scripts/cleanup-webe2e.ts --manifest /root/private/manifest.json`。事务为只读、可重复读；输出各表资源 ID、关联数量、逐行 SHA-256、NFC/换行规范化内容哈希与字符数，不输出正文、邀请令牌或数据库连接串。控制台输出的 `sha256` 是规范化 JSON 的校验值，并非格式化文件的 `sha256sum`。
2. 核对主题、已软删主题、草稿主题和正文楼层数。历史审计预期是 68 / 60 / 8 / 96；这些是人工复核基线，不是可以跳过重新审计的授权。交易、其他用户内容/关联、独立草稿、动态/评论、范围外正文及相关未完成 Outbox 均导致拒绝。
3. 管理入口完成完整数据库 custom dump，校验 SHA-256、`pg_restore --list`，在无网络的新临时数据卷/容器恢复并核对计数。不得恢复到活动卷。把备份与恢复证据绑定到本次 manifest；备份后发生范围漂移必须重新审核并补备份。
4. 创建 root 所有、0600 的备份证明 JSON，字段如下。路径必须指向 root 所有且无组/其他用户权限的普通文件；禁止符号链接。

```json
{
  "version": 1,
  "manifestSha256": "dry-run 输出的 SHA-256",
  "dumpPath": "/root/private/database.dump",
  "dumpSha256": "实际备份文件 SHA-256",
  "restoreVerified": true,
  "restoreEvidencePath": "/root/private/restore-verified.txt",
  "restoreEvidenceSha256": "实际恢复证明文件 SHA-256"
}
```

5. 管理身份执行 `pnpm exec tsx scripts/cleanup-webe2e.ts --apply --manifest /root/private/manifest.json --sha256 <原校验值> --backup-proof /root/private/backup-proof.json`。工具实际读取并计算备份/恢复证据哈希；恢复是否成功由治理签署的私有证明负责，不能只创建空的“已验证”标记。
6. apply 在短事务内锁定受影响关系并重新计算完整 manifest。锁等待上限 5 秒、事务上限 30 秒，超时回滚，不终止线上会话。表锁期间会短暂阻止相关业务写入，应由治理选择操作窗口。仅删除 manifest 中主题，FK 级联释放其关联；共享媒体仍被其他内容引用时保留，无引用完成媒体设置 `orphanedAt`，交给现有回收任务处理，不直接删除文件。
7. 同事务新增审计凭据（现有 `CONTENT_HIDDEN` 分类，metadata 的 `operation=webe2e-hard-delete-v1` 明确为硬删除），保存 manifest/备份哈希及缓存待办。账号、钱包、其他审计记录均保留。Redis 仅删除各主题 stats、移除三个排行榜中的指定主题、失效推荐 ready 标记；不执行 FLUSH。失败退出时保留 `cacheInvalidation=pending`，使用**原 manifest、原校验值、原备份证明**重复 apply 完成补偿。已提交清理不会再次删除新建主题。
8. 治理只读核对用户主题/正文归零、账号钱包审计保留、媒体引用与缓存结果。工具不负责部署、重启或替用户确认线上删除。

## 隔离测试基础进程

`scripts/e2e-resources.ts` 为每次测试创建 0700 临时目录、随机 runId、全新 PostgreSQL 集群与 Redis 进程，不复用任何已有数据库或 Redis 实例。随机口令仅在私有文件和子进程环境中传递。进程/端口/Redis 实例 ID 记录在私有 `resources.json`，PostgreSQL `cluster_name` 和 Redis 身份键须一致。

开发身份需配置 `E2E_PG_BIN`（包含 initdb/postgres 的只读目录）与 `E2E_REDIS_BIN`（redis-server 绝对路径）；额外动态库通过 `E2E_LIBRARY_PATH` 明确指定。配置只涉及二进制，不包含线上数据凭据。禁止填写任何其他任务的 pg-data/redis-data 目录。每次正常、失败、SIGINT/SIGTERM 结束均仅停止自己实际创建的进程组，按 ownership 记录校验后删除自己目录；身份漂移时保留现场并拒绝删除未知资源。SIGKILL/主机故障残留在下一轮启动时仅按当前 checkout 的私有登记回收；身份不可核验时停止并交由治理处理，不扫描或接管其他 checkout。

清理工具验证：`pnpm test:cleanup:unit`；真实事务/并发/FK/共享媒体/缓存重试验证：配置上述只读二进制后执行 `pnpm test:cleanup:integration`。所有数据写入均发生于本次新启动的进程。

## Web 接入协议（v1）

完成后端 `pnpm check`（含构建）并配置上述只读二进制后，使用后端已提交 checkout 运行：

```bash
pnpm e2e:run -- pnpm --dir /absolute/path/to/web <Web隔离测试命令>
```

runner 为每次执行生成独立 PostgreSQL/Redis、随机数据库与账号、随机 loopback API 端口，应用只使用 `wenyousite_app`。迁移 owner 仅存在于这个一次性集群，Web 子命令不获得数据库连接串、Redis 口令或 JWT 密钥。邮件使用 test JSON transport、推送/Sentry/COS 关闭；后端从本次私有目录启动，不加载产品 checkout 的 `.env`，子进程环境使用白名单，禁止继承 `NODE_OPTIONS` 及线上环境凭据。上传目录为本次 `uploadPath`；COS 关闭时媒体上传按正常业务配置拒绝，不增加测试后门。

Web 子命令启动时得到以下 env；值只在当前子进程和 `E2E_PRIVATE_ENV` 指向的 **0600 JSON 文件**内，不得打印或持久化账号口令：

| 环境变量 | 含义 |
| --- | --- |
| `E2E_RUN_ID` | `e2e_` + 24 位随机 hex，每轮全新 |
| `E2E_MANIFEST` | 本次 0600 `manifest.json` 的绝对路径 |
| `E2E_PRIVATE_ENV` | 本次 0600 `private.env.json`；键值与本表相同 |
| `E2E_BACKEND_URL` | 后端 origin，例如 `http://127.0.0.1:<随机端口>` |
| `API_BASE` | `<E2E_BACKEND_URL>/api/v1` |
| `E2E_USER_ID` / `E2E_USERNAME` / `E2E_EMAIL` / `E2E_PASSWORD` | 本次唯一随机账号；通过正常登录 API 获取会话 |

manifest 不包含口令，v1 字段为：`version=1`、`runId`、`state=ready`、`backendURL`、`apiBase`、`privateEnvPath`、`resourcesPath`、`uploadPath`、`postgres={host,port,database,clusterName}`、`redis={host,port,instanceId}`。所有路径均位于本次 0700 目录；只有 API 健康后才发布 ready manifest 并启动 Web 命令。Web 必须验证 runId、私有文件权限、loopback 随机端口、manifest/API 地址一致；不得接受裸 `API_BASE`、已有登录态或公网地址。Web server、Playwright 浏览器应作为测试子命令的后代运行，结束时显式关闭；runner 还会按随机身份核对进程组并清理遗留后代。

正常、测试失败与 SIGINT/SIGTERM 结束时，runner 停止消费者/后端/数据进程，清理数据库、Redis 数据、上传目录及私有账号文件；只输出无凭据的 ready/passed 状态。连续两轮测试必须获得不同的 runId/账号/目录，每轮结束后其目录与进程均应消失。`SIGKILL`/主机故障无法运行 finally；下一轮只回收本 checkout 登记且 supervisor 已失活的残留，活动任务保持独立运行。无法核验时使用下述残留入口，不回退为复用资源。失败测试可保留 0600 `/tmp/wenyousite-e2e-failure-<runId>.log` 供本机诊断；它不是可复用环境，不应上传聊天/Git，诊断结束由本任务清理。

后端入口统一为 `pnpm test:e2e`（HTTP 主链）、`pnpm test:e2e:full`（HTTP + 认证终端/经济/媒体/排行/管理/收藏）、各原 `test:integration:*` 命令，以及 `pnpm e2e:run --suite=<auth|economy|media|ranking|admin|display|bookmarks|bookmark-count|search>`。底层脚本直接调用时必须先校验 manifest，再只读验证真实 PostgreSQL `cluster_name` 与 Redis 实例/身份键；缺少 runner 环境立即拒绝，`API_E2E_ENV=test` 本身不再放行。

## 安装与异常残留

治理可从已校验、没有运行数据的发行包解压根执行 `bash scripts/prepare-e2e-tools.sh --source-root <包解压根>`，安装固定只读工具到 `/opt/wenyousite/e2e-tools`。脚本不启用 systemd、不接触 Docker/线上网络与卷、不复制 pg-data/redis-data，不覆盖已有安装。输出仅含三个无凭据配置路径；开发身份只需这些路径，不持有线上管理凭据。也可使用管理员已安装的兼容 PostgreSQL/Redis 二进制。

对被 SIGKILL 的任务，先确认 supervisor 已退出，再以原运行 UID 执行：

```bash
pnpm e2e:reap --root /tmp/wenyousite-e2e-<原目录后缀> --run-id <原runId>
pnpm e2e:reap --root /tmp/wenyousite-e2e-<原目录后缀> --run-id <原runId> --apply
```

默认 dry-run；核对 ownership、UID、supervisor 启动时间、原进程组/PID 启动时间及进程 env 中的随机身份（Redis 改写 environ 时，仅原 leader 允许以原启动时间和私有 cwd 双重核验）后，apply 只终止匹配进程并清理该目录。原任务仍活跃、PID 复用、路径/身份漂移或进程不可核验时拒绝，不能使用递归删除/FLUSH 代替验证。该授权不包括其他任务资源或公网数据库。
