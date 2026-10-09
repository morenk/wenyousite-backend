# Android 下载网关

此协议由 Backend 维护，OpenAPI 从 `src/app-downloads` 的 DTO/Swagger 生成。独立网关与主 API 使用同一提交构建。本次只交付代码与模板，不部署、不修改 RainS3 配置、不发布正式包。

## 跨仓契约 v1

| 接口 | 行为 |
| --- | --- |
| `GET /api/v1/app-downloads/android` | 匿名 JSON，成功 envelope `{code:0,message:"ok",data:AndroidDownloadInfoDto}` |
| `GET /api/v1/app-downloads/android/{buildNumber}/file` | 固定构建 APK，200 完整正文或 206 单段 Range |
| `HEAD /api/v1/app-downloads/android/{buildNumber}/file` | 与 GET 相同元数据，无正文，不计出站字节，仍计请求频率 |

JSON 顶层为 `status`（`available/no_release/withdrawn/paused/unavailable`）、`release`（仅 available 非 null）和 `retryAfterSeconds`（整数秒或 null）。状态事实源为发布 CLI 原子写入的 catalog；withdrawn/paused 会同时拒绝所有已发布文件 URL。无推荐返回 no_release，明确撤回返回 withdrawn，运维暂停返回 paused，推荐缓存缺失或损坏返回 unavailable；这些均 HTTP 200。账本/目录依赖异常才 503，IP 限频 429。`release` 字段：`platform="android"`、`applicationId="site.wenyou.app"`、`versionName`、`buildNumber`（整数）、`sizeBytes`（整数）、`sha256`（小写 64 hex）、`fileName`、`publishedAt`（ISO 8601）、`downloadUrl`（本站固定构建文件绝对 URL）、`releaseNotesUrl`（本站 `/api/v1/mobile-releases/android/{buildNumber}`）。JSON 使用 `Cache-Control: no-store`。

Web 常驻下载入口为 ThemeMenu「下载 APP」，不提供独立 `/download` 页面或二维码。用户一次显式点击后，先请求上述 JSON 获取当前版本与状态；仅当状态为 available，且下载 URL 与构建号校验通过时，对同一固定构建文件发起 HEAD，核对响应状态、文件类型、大小、SHA-256 元数据、包名、版本名与构建号。全部匹配后由浏览器原生 GET 下载该文件，无需再次点击确认。非 available、查询失败或 HEAD 校验失败时显示相应状态及重试提示，不发起 APK GET；后续重试由用户显式触发。页面加载、菜单展开或悬停均不触发这条查询/校验/下载链路。

移动设备（Android/iOS）在浏览器会话首次访问时自动显示下载提示；按真实移动设备识别，不因桌面窗口变窄而触发。提示可关闭，同一会话不重复弹出。文案明确目前仅提供 Android 安装包，iOS 用户可继续使用网页版，不暗示存在可安装的 iOS APP。提示的展示与关闭均不发起 APK HEAD/GET，用户点击提示中的下载操作后，复用上述版本/状态查询、HEAD 校验与原生 GET 流程。

文件响应保留 `Content-Type: application/vnd.android.package-archive`、`Content-Length`、`Content-Disposition: attachment; filename="wenyou-<version>-<build>.apk"`、`x-amz-meta-apk-sha256`、`x-amz-meta-application-id`、`x-amz-meta-version-name`、`x-amz-meta-version-code`，另有 SHA-256 ETag、Last-Modified、Accept-Ranges。200/206 使用 `Cache-Control: private, no-store`，禁止 Caddy/CDN 缓存绕过预算。允许空 Referer，无登录、JS 或验证码前置条件。旧 APP 可原样先 HEAD 再 GET；客户端应接受缓存策略变化。

Range 只支持单段 `bytes=start-end`、`bytes=start-`、`bytes=-suffix`；非法、多段、越界均为 416，含 `Content-Range: bytes */<size>`。If-Range 不匹配时发送完整文件；非法 Range 不因 If-Range 而放行。HEAD 支持相同范围选择。错误为标准 `{code,message,data:null}`（HEAD 无正文）：404 未发布/未知构建，416 错误范围，429 请求/并发/预算超限且带 Retry-After，503 缓存缺失/损坏、持久化故障或未接通网关。错误不含桶、对象键、IP、凭据或内部路径。

### 每日下载尝试次数（5.32 兼容扩展）

默认同一有效浏览器标识每天 3 次，单 IP 总计每天 10 次；设备与 IP 分别累计、互相独立、跨构建号共享，按北京时间每天重置。计的是获准传输的下载尝试：GET 完成路由、Range、发布策略与缓存校验后，在准备发送正文的最后阶段用同一 SQLite 事务预占一次设备/IP 次数及完整响应长度的字节预算。任何次数、容量或字节限额拒绝都会回滚整笔预占。HEAD、info、预检失败均不扣下载次数；有效 Range GET 每次计一次，预占后断连、传输失败和主动重试不退。错误 JSON 仍按实际响应字节收费，这不属于 APK 正文预占。

HEAD 对同一访客预检次数与所请求范围的字节预算，但不预留；HEAD 成功与后续 GET 之间可能有并发竞争，GET 仍以服务端最终事务为准。info 的 release/status 始终表示全局发布、缓存及字节可用性，不因某位访客用尽次数而改为 paused；不输出个体余额，也不缓存个体拒绝为全局版本状态。请求频率、并发和带宽保护继续覆盖 HEAD、info 与失败请求。

429 的 `X-Download-Limit-Reason` 枚举为 `device_daily_limit`、`ip_daily_limit`、`byte_budget`、`request_rate`、`concurrency`、`bandwidth`。设备/IP 次数耗尽时 `Retry-After` 为到北京时间下一日的整数秒；其他原因使用相应预算或限流等待时间。HEAD 无正文，GET 在无法容纳错误正文时也可能只有状态与响应头；客户端先读 HTTP 状态/原因头/Retry-After，不能依赖 JSON 必然存在。Web 在 HEAD 拒绝时就地反馈，不启动原生 GET；原生 GET 仍可能因竞争拒绝，不自动重试。

第一方随机浏览器标识用 HMAC-SHA256 签名 Cookie 传递：生产名为 `__Host-wenyou-download-device`，`Path=/; HttpOnly; SameSite=Lax; Secure`，不设置 Domain，最长 30 天。合法 Cookie 保留同一随机标识，接近到期或密钥轮换时续签；篡改、重复同名、未知签名、过期或缺失按无有效标识处理并签发新随机标识，不接受客户端自报设备 ID。info 或有效文件 HEAD/GET 均可签发，客户端让同源浏览器自动携带和接收，不读取/复制 HttpOnly 值。签发本身不落次数记录，只有获准 GET 才计次。

Cookie 可清除、浏览器可拒绝保存，不能保证物理设备唯一。没有有效 Cookie 的客户端仍受同一可信 IP 的总次数限制；直接 GET 新签发的随机标识也记本次尝试，但客户端不保存就无法在后续请求识别为同一设备。旧 Android APP 不必增加 info、Cookie 或改变 URL，可直接先 HEAD 再 GET，保持原 metadata；共享 Wi-Fi/NAT 的客户端共用 IP 10 次。IP 只取 Caddy 覆写且已规范化的 X-Real-IP，客户端自报转发头不参与身份。次数表只存按日及类别隔离的 HMAC 伪名，不存原 IP 或 Cookie，日志与公开指标不输出标识/密钥。

默认配置可由管理身份通过 `DOWNLOAD_DEVICE_DAY_COUNT=3`、`DOWNLOAD_IP_DAY_COUNT=10` 调整，不接受请求参数覆盖。`DOWNLOAD_COUNT_MAX_SUBJECTS=100000` 限制同一天设备/IP 伪名总行数；到上限时拒绝新主体（503），不逐出当日有效计数，既有主体仍按自身余额判定。下一北京时间日首次成功的正文计量事务删除过期次数/主体行；空闲时最多保留上次活动日，不随 Cookie 签发或 HEAD 增长。SQLite 数据文件强制 4 KiB 页、最大 16384 页（64 MiB），WAL 每 256 页尝试 checkpoint、回收后保留上限 1 MiB；长事务可临时延迟 WAL 回收，不能通过清空账本释放额度。文件或存储耗尽时拒绝服务。数据文件上限依据 [SQLite max_page_count](https://www.sqlite.org/pragma.html#pragma_max_page_count)。

### 账本升级、签名持久化与轮换

全新出站账本显式初始化为 v2；回源账本仍为 v1。已存在的出站 v1 不可删除重建：管理身份先停止网关，保留离线备份（含 SQLite 已提交 WAL 状态），再执行 `node <release>/dist/app-downloads/download-cli.js upgrade-egress-ledger --env <专用配置>`。CLI 取得既有 gateway-lock 后，在单事务中增加次数表和密钥状态并更新版本；原日/月字节 counters、clock、文件 inode 与缓存/目录不变。重复升级只验证已有 v2，不重新生成密钥或清零任何额度。新网关遇到未升级 v1、损坏或缺失密钥即拒绝启动；升级失败保持原状态供修复。

签名密钥与用于计数伪名的独立 HMAC 密钥由显式初始化/升级生成，保存在私有 0600 出站 SQLite 和 0700 目录内，随账本持久化/备份；不放公共配置、环境、命令参数或日志，重启不重新生成。离线 `rotate-device-key --env <专用配置>` 同样取得网关锁，保留旧签名密钥最多 30 天验证宽限；浏览器下次请求以原随机 ID 换发新签名，计数伪名密钥不变，当前次数不重置。只保留当前/上一代两把签名密钥，上一代宽限未结束时拒绝再次轮换，避免静默使有效 Cookie 失效；当前程序须重启读取新密钥。

升级前可回滚尚未提交的 SQLite 事务；升级后旧 v1 程序按版本校验拒绝 v2，不能通过删表、删库、恢复旧快照或降版本放开已用额度。优先前滚修复或回滚到支持 v2 及同一次数语义的实现，并保留当前账本；灾难恢复仍遵循独立新卷、备份验证与显式切换门禁，不能自动覆盖活动账本。

`/meta.mobileCompatibility.android.updateUrl` 迁移后为 `https://wenyou.site/api/v1/app-downloads/android/{buildNumber}/file`；iOS 不变。旧数据库 promotion.updateUrl 与历史 TSV 原文保留，通过独立制品记录存储 bucket/key/publicUrl，不重写旧审计事实。

## 进程和运维交接

- 公共 socket：`/run/wenyousite-download/gateway.sock`。Caddy 覆盖 `X-Real-IP` 与 `X-Forwarded-For` 为真实 peer IP，删除 `Forwarded`；网关仅取覆盖后的单值 `X-Real-IP`；仅经受控 Unix socket 访问，不开放公网 TCP。
- 公共进程用户 `wenyousite-download`，socket group `wenyousite-download-proxy`（仅 Caddy 与网关成员），缓存读取 group `wenyousite-download-cache`。发布用户 `wenyousite-download-publisher` 写缓存和制品目录；公共进程只有只读权限。
- 公共环境 `/etc/wenyousite/download.env`；私有回源环境 `/etc/wenyousite/download-origin.env` 只提供给显式发布预热/修复 CLI，不能传入网关 unit。允许在该专用私有配置中复用已有存储凭据，不要求新建独立只读凭据，不修改原凭据权限以免影响已有上传/图片。代码固定桶 `wenyou-apk`、键 `mobile/android/wenyou-<version>-<build>.apk`，仅调用所需 HEAD/GET；这是应用访问限制，不代表现有凭据在云端只读或仅限 APK，泄漏仍可能影响其原有全部授权资源。
- 缓存 `/var/cache/wenyousite-download`，公开目录 `/var/lib/wenyousite-download/catalog`；出站账本 `/var/lib/wenyousite-download/egress/budget.sqlite`，回源账本 `/var/lib/wenyousite-download/origin/budget.sqlite`。账本显式初始化，运行时缺失/损坏拒绝服务，不重建或清零。
- 全局 4 Mbps / 4 并发，每连接 2 Mbps、每 IP 2 并发、每 IP 每分钟 30 请求（含 HEAD、GET 失败）；无无限等待队列。带宽为十进制 bit/s；容量和预算为 GiB/MiB。
- 北京时间日/月：出站 5 GiB/100 GiB，回源 512 MiB/2 GiB。SQLite 事务预留完整发送长度，断开/失败不退款；跨日/月连接归属预留时段，重启保持累计。健康探针只返回健康，不读写或暴露预算。
- 缓存上限 1 GiB，保留推荐与最近两个其他已发布包（集合去重）；不足则预热失败，不逐出保留包。公众 miss 503，不访问 S3、不重定向源站。显式预热/修复合并同制品工作，按尝试预留回源流量，流式落盘验证大小/SHA-256/包名/构建号，fsync 后原子启用。

CLI 固定入口 `node <release>/dist/app-downloads/download-cli.js <command> --env <配置文件>`；不从参数接收密钥。命令：`init-ledger --kind egress|origin`（只创建不存在账本）、`register --manifest <JSON>`、`warm --build <n>`、`repair --build <n>`、`publish --build <n> --published-at <ISO> --publication-proof <root 所有的 JSON>`、`withdraw`、`pause`、`resume`、`status`、`verify-cache --build <n>`。`verify-origin --build <n>` 单独鉴权 HEAD；`warm/repair/verify-origin` 另用 `--origin-env <私有环境文件>`。制品 manifest v1 字段为 `schemaVersion=1,applicationId,versionName,buildNumber,sizeBytes,sha256,bucket,key,legacyUpdateUrl`；publicUrl 由 build 计算。先版本说明预检、登记/鉴权预热，再受限晋级；`publish` 只能在版本说明发布确认后执行。输出只有状态与制品身份。

迁移顺序：兼容网关与发布工具 → 预热现有包 → 切 meta/Web → 旧 APP HEAD+GET 验收 → 独立评审关闭 APK 公共读。只允许 APK 权限变化，不修改图片桶或 RainS3 实例开关；不自动购买流量。

主 API 未注入网关 handler 时这些路由返回 503，不能绕过独立网关。Caddy 只将 `/api/v1/app-downloads/*` 路由到 UDS；socket 无监听时 Caddy 返回 502，不回落主 API 或源站。治理实现固定于 wenyousite-workspace 提交 `22f129c`。


## 预算、缓存和失败语义

SQLite 使用 `BEGIN IMMEDIATE`、WAL 和 `synchronous=FULL`，每次正文发送前同时检查/写入北京时间日与自然月两个计数。JSON 成功/错误正文也预留并共享全局带宽；HEAD 不预留正文。预算连错误 JSON 都无法容纳，或瞬时带宽桶已耗尽时，429/503 只返回状态、Retry-After 与零长度正文，消费者须按 HTTP 状态兜底。容量上限与断开不退款不受时区环境变量影响。管理配置可显式设置 `DOWNLOAD_DAY_BYTES/MONTH_BYTES` 与 `DOWNLOAD_ORIGIN_DAY_BYTES/MONTH_BYTES`，省略为上述默认；提高额度必须经过运维评审，不自动调整。时钟回拨、账本被替换、缺失、损坏或锁失败均拒绝。下载信息接口在完整 APK 剩余额度不足时返回 paused 及重试秒数，不暴露余额。

同一 egress 目录通过独立 SQLite 排他事务锁限制为一个进程；锁在异常退出后由内核释放，重启不清预算。启动不移除既有 socket。缓存 O_NOFOLLOW 打开，检查普通文件/链接数/写权限，通过同一 fd 计算 SHA-256、校验二进制 AndroidManifest.xml 的包名/版本/构建号并发送；校验缓存按 inode、大小、mtime、ctime 失效。网络调度每连接最多等待一块，轮转公平，没有无限队列，最多四条发送连接，背压/关闭/超时均释放槽位；已经预留的字节不退回。

预热进程串行写目录，同制品并发合并为一次 GET；SDK 隐式重试关闭，仅上游 500/502/503/504 最多显式重试一次。每次尝试先预留 APK 大小 + 128 KiB 有界元数据/错误传输余量；HEAD 独立鉴权预留 128 KiB。失败也收费。错误体上限 64 KiB，APK 主体 64 KiB 级流式落盘，清单解压限制 1 MiB。超时十分钟，失败临时文件正常清理，SIGKILL 留下的 `.part` 继续占容量，绝不当成有效 APK。

1 GiB 容量包含全部完整文件、本次临时文件和异常遗留文件。为避免删除在途 inode 后低估实际磁盘占用，在线预热不会逐出旧包；修复替换的旧 inode 也改名保留为 `.part`，继续计入容量；容量不足明确失败。管理身份在独立维护窗口停止网关后，用 `flock -n /var/lib/wenyousite/deploy.lock /var/lib/wenyousite/backend/current/bin/node /var/lib/wenyousite/backend/current/dist/app-downloads/download-cli.js prune --env /etc/wenyousite/download.env` 与晋级互斥；CLI 再取得网关排他锁和发布锁，保留推荐及最近两个其他已发布包（去重），仅清理目录内已登记旧制品及符合本工具命名的 `.part`。本任务不执行停机或清理。

## 受限发布与历史迁移

现有 `promote-android-release.sh` 加前置 `--gateway` 启用新通道，原 `--url` 继续传 RainS3 对象地址，作为原始制品身份。顺序为：登记独立 `mobile_download_artifacts` → 私有 HEAD/GET 预热与真实清单核验 → 私有 HEAD 鉴权 → 检查缓存 → 领取原说明发布状态机 → commit 公开说明 → 导出 root 所有的发布证明 → 原子启用网关 catalog → 修改 meta 环境并重启验证 → 追加原格式 TSV → finish。所有写入由已有受限 root 管理入口运行，公开下载进程不取得数据库或源站凭据。

`register-download` 和 `download-proof` 为 `mobile-release-cli` 内部命令。独立新增表固定 releaseId、SHA/大小、bucket/key 与 publicUrl，不更新旧 promotion 或旧 TSV。迁移只新增表/唯一键/FK，不回填、删除或改写历史内容。已发布旧包可再次以相同 identity 运行 `--gateway` 完成迁移；不同 SHA/大小或源站身份拒绝。普通旧通道仍保留，关闭公共读后不得再使用旧通道。

本地 journal 在切换前同步保存 meta/TSV/catalog。任一步失败恢复三者并补偿原说明状态，数据库不可达时保留恢复记录。中断后仅使用原 `--recover` 恢复；未完成恢复时拒绝新的晋级。网关 withdraw 同步阻止所有旧文件 URL；pause 可 resume，withdraw 只能重新经过发布流程，不由 resume 复活。

## 运行模板与安全检查

模板为 [独立 systemd unit](../ops/wenyousite-download.service)、[无密钥配置](../ops/secrets/download.env.example) 和 [私有回源配置](../ops/secrets/download-origin.env.example)。Node 使用已部署不可变 release 内的 24.x 运行时与构建；SQLite 与应用数据卷一并持久保存，不用 tmpfs 或 Redis AOF 替代。迁移/启用均须从合并提交经管理部署门禁，不从开发工作树执行。

目录初始权限：catalog/cache 为 publisher:wenyousite-download-cache、2750；egress 为 wenyousite-download、0700；origin 为 publisher、0700；inbox 为 root:wenyousite-download-cache、0750。publisher 主组 `wenyousite-download-publisher`、附加 cache 组；网关附加 cache 组，Caddy 仅附加 proxy 组。公共配置 root:cache 0640，origin 配置 root:publisher 0640。分别以对应运行身份执行 `init-ledger --kind egress|origin`，只允许首次显式初始化；已存在账本拒绝覆盖。预热不自动读取 backend.env 或继承图片 SDK 凭据；复用时由授权管理身份单独配置 origin 文件，不复制整份生产配置。公开网关不得持有、读取或继承任何 S3 凭据。日志不输出密钥、原始配置或带凭据错误；本代码交付不读取/打印真实密钥，不配置服务器或修改云策略。

unit 限制 AF_UNIX、PrivateNetwork、MemoryMax=256M、MemoryHigh=192M、CPUQuota=50%、TasksMax=32、只读缓存/目录，明确隐藏 backend/migration/origin 配置与私有回源目录。`node --import tsx scripts/validate-download-security.ts` 验证模板；管理安装后加 `--installed` 校验安装模板及公共配置权限，仍需现场核验有效 unit、身份/组、目录权限和 Caddy 覆写 IP。`GET /__health` 与 `GET /__metrics` 仅供本机 UDS 管理探针；Caddy 不转发它们。健康探针不读账本或消耗预算；内部指标包含聚合请求/拒绝原因/完成/中断/活动数、缓存命中/失败数与只读出站预算累计；回源量由 publisher 的 status 只读查询独立账本。不含 IP、对象路径或凭据；预算指标不得暴露给公开下载信息接口或健康探针。

## 隔离验证

`pnpm test:downloads` 执行类型检查、真实 UDS、私有对象存储、持久预算、并发/限速、失败恢复与模板拒绝测试；测试目录独立且清理。`pnpm test:integration:app-downloads` 由标准 E2E runner 创建并核验独立 PostgreSQL/Redis，再验证新增 migration 重入、旧用户/钱包/制品审计保留、真实注册并发和私有预热。已纳入完整门禁。首次定向验证可使用 `pnpm e2e:run --suite=app-downloads --source` 启动本任务源码（仍使用同一隔离身份校验），正式完整门禁使用构建产物。测试对象存储拒绝未签名 GET/HEAD，完全使用合成 APK，不访问 RainS3。

日常 Web 调试按各仓库普通开发入口按需启动。持续隔离预览及其 HTTP Cookie 模式已退役，下载网关始终签发带 Secure 的 Cookie，旧配置会被拒绝；自动化下载和写入验证继续使用上述独立测试入口。

持久性依据 [SQLite synchronous](https://sqlite.org/pragma.html#pragma_synchronous)，二进制清单格式依据 [Android ResourceTypes](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/androidfw/include/androidfw/ResourceTypes.h)。这些实现证据不代替真实 RainS3 鉴权读取验证、有效 systemd/Caddy 部署或旧 APP 真机验收；关闭公共读仍须独立评审。
