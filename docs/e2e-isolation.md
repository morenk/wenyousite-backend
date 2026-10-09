# E2E 数据隔离与历史测试内容清理

公网环境承载需要保留的用户内容与审计数据。所有自动化测试写入必须使用独立 PostgreSQL 进程、Redis 进程和本次上传目录；loopback 地址、测试库名、Redis DB 编号或专用测试账号均不能证明隔离。公网只读验收，不再提供定向写入例外。

## webe2e 历史清理

此入口仅处理固定 ID `cmtt21ub700007qfeleo3j76y` 与 username `webe2e` 的历史主题及其关联，保留账号、钱包和现有审计。旧 `pnpm test:cleanup` / `scripts/cleanup-testuser.ts` 始终拒绝执行，不再删除 `testuser`，也不接受替换用户名。

治理管理入口显式注入 `CLEANUP_DATABASE_URL` 与 `CLEANUP_REDIS_URL`，不得把凭据放在命令行、聊天、Git 或仓库 `.env`。使用已提交工具，以 root 私有目录保存所有操作材料。

1. 默认 dry-run：`pnpm exec tsx scripts/cleanup-webe2e.ts --manifest /root/private/manifest.json`。事务为只读、可重复读；输出各表资源 ID、关联数量、逐行 SHA-256、NFC/换行规范化内容哈希与字符数，不输出正文、邀请令牌或数据库连接串。控制台输出的 `sha256` 是规范化 JSON 的校验值，并非格式化文件的 `sha256sum`。
2. 核对主题、已软删主题、草稿主题和正文楼层数。历史审计预期是 68 / 60 / 8 / 96；这些是人工复核基线，不是可以跳过重新审计的授权。目标主题的交易 FK 引用、其他用户内容/关联、独立草稿、动态/评论、范围外正文及相关未完成 Outbox 均导致拒绝。
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
7. 同事务新增审计凭据（现有 `CONTENT_HIDDEN` 分类，metadata 的 `operation=webe2e-hard-delete-v1` 明确为硬删除），保存 manifest/备份哈希及缓存待办。账号、钱包、无关账务和其他审计记录均保留。manifest v2 的 `preserved` 保存完整账号、钱包的行哈希与相关账务的 ID/行哈希；无关账务不阻止内容清理，但其新增、删除或变动会使原 manifest 失效。事务内删除前复核完整 manifest，删除后再次复核 `preserved`，不一致即回滚；旧版 manifest 必须重新生成并绑定备份证明。Redis 仅删除各主题 stats、移除三个排行榜中的指定主题、失效推荐 ready 标记；不执行 FLUSH。失败退出时保留 `cacheInvalidation=pending`，使用**原 manifest、原校验值、原备份证明**重复 apply 完成补偿。已提交清理不会再次删除新建主题。
8. 治理只读核对用户主题/正文归零、账号钱包审计保留、媒体引用与缓存结果。工具不负责部署、重启或替用户确认线上删除。

## 隔离测试基础进程

`scripts/e2e-resources.ts` 为每次测试创建 0700 临时目录、随机 runId、全新 PostgreSQL 集群与 Redis 进程，不复用任何已有数据库或 Redis 实例。随机口令仅在私有文件和子进程环境中传递。进程/端口/Redis 实例 ID 记录在私有 `resources.json`，PostgreSQL `cluster_name` 和 Redis 身份键须一致。

开发身份需配置 `E2E_PG_BIN`（包含 initdb/postgres 的只读目录）与 `E2E_REDIS_BIN`（redis-server 绝对路径）；额外动态库通过 `E2E_LIBRARY_PATH` 明确指定。配置只涉及二进制，不包含线上数据凭据。禁止填写任何其他任务的 pg-data/redis-data 目录。每次正常、失败、SIGINT/SIGTERM 结束均仅停止自己实际创建的进程组，按 ownership 记录校验后删除自己目录；身份漂移时保留现场并拒绝删除未知资源。SIGKILL/主机故障残留在下一轮启动时仅按当前 checkout 的私有登记回收；身份不可核验时停止并交由治理处理，不扫描或接管其他 checkout。

清理工具验证：`pnpm test:cleanup:unit`；真实事务/并发/FK/共享媒体/缓存重试验证：配置上述只读二进制后执行 `pnpm test:cleanup:integration`。所有数据写入均发生于本次新启动的进程。

CI 的 integration job 在固定 Ubuntu 24.04 runner 准备 PostgreSQL 16 与 Redis 可执行文件，显式校验并传递 `E2E_PG_BIN` / `E2E_REDIS_BIN`。`pnpm test:e2e:full` 复用同一份完整 suite 清单，随后 `pnpm test:e2e` 单独验证默认契约开关；两次运行分别创建并清理资源，不使用前面的迁移权限测试 service 数据库。缺少二进制或隔离身份验证失败时立即失败，不回退到 CI service 或公网实例。

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

`pnpm test:integration:profile-follow-counts`（`--suite=profile-follow-counts`）通过本次隔离 API 和真实 Prisma 聚合验证注销关系保留时资料计数与列表一致、双向拉黑、单向移除及游客缓存命中/过期；已纳入 `test:e2e:full`。随机账号、缓存和所有关系由该 runner 随本轮资源清理，不复用持续预览。

## 安装与异常残留

治理可从已校验、没有运行数据的发行包解压根执行 `bash scripts/prepare-e2e-tools.sh --source-root <包解压根>`，安装固定只读工具到 `/opt/wenyousite/e2e-tools`。脚本不启用 systemd、不接触 Docker/线上网络与卷、不复制 pg-data/redis-data，不覆盖已有安装。输出仅含三个无凭据配置路径；开发身份只需这些路径，不持有线上管理凭据。也可使用管理员已安装的兼容 PostgreSQL/Redis 二进制。

对被 SIGKILL 的任务，先确认 supervisor 已退出，再以原运行 UID 执行：

```bash
pnpm e2e:reap --root /tmp/wenyousite-e2e-<原目录后缀> --run-id <原runId>
pnpm e2e:reap --root /tmp/wenyousite-e2e-<原目录后缀> --run-id <原runId> --apply
```

默认 dry-run；核对 ownership、UID、supervisor 启动时间、原进程组/PID 启动时间及进程 env 中的随机身份（Redis 改写 environ 时，仅原 leader 允许以原启动时间和私有 cwd 双重核验）后，apply 只终止匹配进程并清理该目录。原任务仍活跃、PID 复用、路径/身份漂移或进程不可核验时拒绝，不能使用递归删除/FLUSH 代替验证。该授权不包括其他任务资源或公网数据库。

进程组清理逐项核验 `/proc` 身份。若读取 `stat` 后进程退出导致 `environ` 为空或不可读，只在重新读取确认同一启动时间的进程已进入 Z/X 状态，或 PID 已消失时视为结束；活跃身份不符、无法确认退出或 PID 复用仍拒绝清理。`test:cleanup:unit` 确定性覆盖这些竞态，`test:e2e:lifecycle` 覆盖并发、失败、遗留后代、SIGINT/SIGTERM 及 SIGKILL 定向恢复，不以重试成功替代当轮清理验收。

清理失败时，后端 runner 会输出结构化 cleanup-failed 诊断：仅包含已知阶段、运行编号、进程组编号、白名单异常类别／错误码及受控断言原因。不输出异常正文、堆栈、环境或私有进程日志。诊断不改变身份校验、目录保留条件或验收失败判定；消费者须保留该脱敏 stderr，便于核对残留原因。

Linux 退出期间可能先置位 PF_EXITING，进程仍暂时显示 R，且 environ 已不可读。身份读取失败后，仅当二次 stat 仍是同一启动时间并确认 PF_EXITING 或 Z/X 时，才将原进程视为退出；没有退出标志的活进程与 PID 复用继续拒绝。该处理解决任务验收暴露的既有退出竞态，不扩大可终止进程范围。

管理员会话策略回归使用 `pnpm test:integration:admin-session`，由同一 runner 创建和核验随机资源；已纳入 `pnpm test:e2e:full`。原始脚本拒绝仅设置旧环境标记或 loopback 连接的执行。迁移前后验证使用该隔离 PostgreSQL 实例中的随机子库，迁移工作目录置于运行私有目录，正常完成主动移除；异常退出由 runner 一并回收实例及运行目录。

## 日常开发与一次性 E2E

日常开发按需使用[普通调试入口](development.md)，不依赖每日快照或持续预览会话。写入 E2E 仍必须使用本页一次性 runner，不得使用日常开发数据库；旧预览遗留数据不属于 E2E reaper 的清理范围。

### 管理界面真实 API 联验

`pnpm e2e:run --admin-fixtures -- pnpm --dir /absolute/web <隔离测试命令>` 在同一已核验独立实例额外创建随机 ADMIN/SUPER_ADMIN。消费者环境中的 `E2E_ADMIN_FIXTURES` 指向本轮 0600 `admin-fixtures.json`，结构为 `{version:1,runId,mailboxPath,accounts:[{role,userId,email,password}]}`。读取前验证 runId 与 manifest 一致、文件为本身份 0600 普通文件且目录位于本轮资源根。

浏览器按正常 `/admin/auth/challenge` → `/admin/auth/verify` 登录；验证码仅从该 0700 mailboxPath 下的 0600 Nodemailer JSON 邮件读取，按收件人和本次挑战时间筛选。通过 verify/session 取得管理 Cookie 与 CSRF，再调用真实 API。不提供固定验证码、生产测试后门或数据库凭据；禁止打印账号、邮件、Cookie 或 CSRF。runner 结束一并清理账号、收件箱、上传及进程。

`pnpm test:integration:mobile-releases` 经同一 runner 验证迁移后的真实数据路径、后台 Guard/CSRF、revision 竞争、确认快照与受限发布数据库恢复；不进行真实发包或修改共享策略。

需要已发布修正文案联验时，再加 `--mobile-release-fixtures`：`pnpm e2e:run --admin-fixtures --mobile-release-fixtures -- <消费者命令>`。该选项在本轮实际身份核验后，以 `wenyousite_app`、领域服务和 Publication 状态机创建一条已发布样本（android/build 100）和一条待确认草稿（build 101）；不调用 sudo、对象存储或真实晋级。`E2E_MOBILE_RELEASE_FIXTURES` 指向本轮 0600 JSON `{version:1,runId,published:AdminMobileReleaseDto,draft:AdminMobileReleaseDto}`，包含测试版本/id/revision，无数据库凭据。Web 可据此验证普通管理员修改已发布说明返回 403、超级管理员编辑期间旧公开内容保留、确认后替换。样本不是安装包发布验证。

### 帖子编辑时间

`pnpm test:integration:post-edited-time` 已纳入 `test:e2e:full`，核验实际独立 PostgreSQL/Redis 身份后覆盖 nullable 列迁移前后与重复执行、历史 null 保留、楼层/回复 HTTP 序列化、规范化无改动保存、冲突/拒绝/骰子失败事务回滚、BODY 与聚合写入、置顶和管理员隐藏恢复及发布骰子结算。迁移样本子库和文件仅属于本轮私有目录，finally 清理；runner 继续核验并清理全部独立资源。

### 私帖邀请链接复用

`pnpm test:integration:private-invite-reuse` 经本轮独立 PostgreSQL/Redis 身份验证执行真实 HTTP 与 Prisma 并发回归，已纳入 `test:e2e:full`。覆盖首次并发取得、重复与跨登录会话复用、主动重置旧链接失效、成员权限保留及匿名/非楼主/草稿/公开/软删除拒绝。数据、成员、token 仅在本轮隔离资源中生成；日志只输出受控断言，runner 登记 runId 并清理所有资源。

### APK 下载

`pnpm test:integration:app-downloads` 使用本 runner 核验的独立 PostgreSQL/Redis 与私有样本对象存储，覆盖新增制品位置表迁移、并发登记、旧制品身份/钱包保留和鉴权预热。网关 UDS、预算账本和上传文件均属于本轮目录；退出一并清理。持续页面反馈使用 [下载合成预览](app-download-gateway.md#隔离验证与-web-样本预览)，不混用一次性 reaper。

### 长讨论浏览器样本

`pnpm e2e:run --discussion-fixtures -- <Web 隔离消费者命令>` 在本轮独立资源身份核验后，使用 `wenyousite_app` 创建 1000、5000、10000 三组公开样本；每组含对应数量的主楼，以及首个主楼下对应数量的回复。该选项仅用于消费者模式，不能与 `--full` 或 `--suite` 组合，也不会向持续真实快照预览写入数据。普通测试不传此选项，不创建压力样本。

消费者 env 与 `E2E_PRIVATE_ENV` 同时包含 `E2E_DISCUSSION_FIXTURES`，指向运行根下的 0600 `discussion-fixtures.json`：`{version:1,runId,ownerUserId,otherUserId,scenarios:[{size,threadId,subthreadId,rootPostId,pinnedPostId,editableFloorId,editableReplyId,otherAuthorFloorId,otherAuthorReplyId}]}`。不增加 manifest 字段，不交付数据库、Redis 或签名凭据。消费者读取前必须确认普通文件、UID/0600、文件位于 manifest 同一运行根且 runId 匹配；缺少或不匹配时停止，不回退到其他实例。

奇数编号属于本轮登录用户，偶数属于另一个无登录凭据的样本成员；编号 `size-1` 的主楼置顶，editable ID 对应编号 3，otherAuthor ID 对应编号 2。初始没有删除空洞，浏览器可按正常业务 API 编辑、删除或新建以验证编号连续分配与空洞。`pnpm test:e2e:discussion-fixtures` 用不持有数据库凭据的消费者，验证本轮文件/环境绑定、实际 HTTP 首/中/末定位、置顶、筛选拒绝及样本 ID。全部样本和消费者后代由同一 runner 在成功、失败或中断后回收。

### RP 身份资料楼层

`pnpm e2e:run --suite=rp-profile` 验证 author_version 迁移前后及原 token 组成、引用更新与省略/清除、他人代贴/跨子贴/楼中楼、跨主题与不可读拒绝、原文编辑、媒体/骰子/提及读取、关闭/归档/私帖撤权/双向拉黑、乐观锁并发。已纳入 `--full`；随机迁移子库与所有数据均属于当轮核验资源并由 finally/runner 清理，禁止用公网账号替代。

### 管理撤权与内容事务一致性

`pnpm e2e:run --suite=content-write-consistency` 已纳入 `test:e2e:full`。在本轮身份核验后停止背景 API，使用 `wenyousite_app` 创建服务实例，验证公开/私密主题中管理写入与撤销协作者两种提交顺序；使用 PostgreSQL 锁等待证据控制交错，核对拒绝后内容、媒体、提及、标签和 Outbox 无残留。非空表情使用时间更新后注入故障，覆盖内容创建、编辑与发布的整体回滚，再以原请求和幂等键重试。全部账号、数据和故障注入只属于本轮独立资源，结束由同一 runner 核验并清理。
