# Android 下载网关

此协议由 Backend 维护，OpenAPI 从 `src/app-downloads` 的 DTO/Swagger 生成。独立网关与主 API 使用同一提交构建。本次只交付代码与模板，不部署、不修改 RainS3 配置、不发布正式包。

## 跨仓契约 v1

| 接口 | 行为 |
| --- | --- |
| `GET /api/v1/app-downloads/android` | 匿名 JSON，成功 envelope `{code:0,message:"ok",data:AndroidDownloadInfoDto}` |
| `GET /api/v1/app-downloads/android/{buildNumber}/file` | 固定构建 APK，200 完整正文或 206 单段 Range |
| `HEAD /api/v1/app-downloads/android/{buildNumber}/file` | 与 GET 相同元数据，无正文，不计出站字节，仍计请求频率 |

JSON 顶层为 `status`（`available/no_release/withdrawn/paused/unavailable`）、`release`（仅 available 非 null）和 `retryAfterSeconds`（整数秒或 null）。状态事实源为发布 CLI 原子写入的 catalog；withdrawn/paused 会同时拒绝所有已发布文件 URL。无推荐返回 no_release，明确撤回返回 withdrawn，运维暂停返回 paused，推荐缓存缺失或损坏返回 unavailable；这些均 HTTP 200。账本/目录依赖异常才 503，IP 限频 429。`release` 字段：`platform="android"`、`applicationId="site.wenyou.app"`、`versionName`、`buildNumber`（整数）、`sizeBytes`（整数）、`sha256`（小写 64 hex）、`fileName`、`publishedAt`（ISO 8601）、`downloadUrl`（本站固定构建文件绝对 URL）、`releaseNotesUrl`（本站 `/api/v1/mobile-releases/android/{buildNumber}`）。JSON 使用 `Cache-Control: no-store`。页面只请求 JSON；只有用户点击下载才 GET APK；桌面二维码指向 `https://wenyou.site/download`。

文件响应保留 `Content-Type: application/vnd.android.package-archive`、`Content-Length`、`Content-Disposition: attachment; filename="wenyou-<version>-<build>.apk"`、`x-amz-meta-apk-sha256`、`x-amz-meta-application-id`、`x-amz-meta-version-name`、`x-amz-meta-version-code`，另有 SHA-256 ETag、Last-Modified、Accept-Ranges。200/206 使用 `Cache-Control: private, no-store`，禁止 Caddy/CDN 缓存绕过预算。允许空 Referer，无登录、JS 或验证码前置条件。旧 APP 可原样先 HEAD 再 GET；客户端应接受缓存策略变化。

Range 只支持单段 `bytes=start-end`、`bytes=start-`、`bytes=-suffix`；非法、多段、越界均为 416，含 `Content-Range: bytes */<size>`。If-Range 不匹配时发送完整文件；非法 Range 不因 If-Range 而放行。HEAD 支持相同范围选择。错误为标准 `{code,message,data:null}`（HEAD 无正文）：404 未发布/未知构建，416 错误范围，429 请求/并发/预算超限且带 Retry-After，503 缓存缺失/损坏、持久化故障或未接通网关。错误不含桶、对象键、IP、凭据或内部路径。

`/meta.mobileCompatibility.android.updateUrl` 迁移后为 `https://wenyou.site/api/v1/app-downloads/android/{buildNumber}/file`，不是 `/download` 页面；iOS 不变。旧数据库 promotion.updateUrl 与历史 TSV 原文保留，通过独立制品记录存储 bucket/key/publicUrl，不重写旧审计事实。

## 进程和运维交接

- 公共 socket：`/run/wenyousite-download/gateway.sock`。Caddy 覆盖 `X-Real-IP` 与 `X-Forwarded-For` 为真实 peer IP，删除 `Forwarded`；网关仅取覆盖后的单值 `X-Real-IP`；仅经受控 Unix socket 访问，不开放公网 TCP。
- 公共进程用户 `wenyousite-download`，socket group `wenyousite-download-proxy`（仅 Caddy 与网关成员），缓存读取 group `wenyousite-download-cache`。发布用户 `wenyousite-download-publisher` 写缓存和制品目录；公共进程只有只读权限。
- 公共环境 `/etc/wenyousite/download.env`；私有回源环境 `/etc/wenyousite/download-origin.env` 只提供给发布 CLI，不能传入网关 unit。固定桶 `wenyou-apk`、键 `mobile/android/wenyou-<version>-<build>.apk`，独立只读凭据；不复用图片凭据。
- 缓存 `/var/cache/wenyousite-download`，公开目录 `/var/lib/wenyousite-download/catalog`；出站账本 `/var/lib/wenyousite-download/egress/budget.sqlite`，回源账本 `/var/lib/wenyousite-download/origin/budget.sqlite`。账本显式初始化，运行时缺失/损坏拒绝服务，不重建或清零。
- 全局 4 Mbps / 4 并发，每连接 2 Mbps、每 IP 2 并发、每 IP 每分钟 30 请求（含 HEAD、GET 失败）；无无限等待队列。带宽为十进制 bit/s；容量和预算为 GiB/MiB。
- 北京时间日/月：出站 5 GiB/100 GiB，回源 512 MiB/2 GiB。SQLite 事务预留完整发送长度，断开/失败不退款；跨日/月连接归属预留时段，重启保持累计。健康探针只返回健康，不读写或暴露预算。
- 缓存上限 1 GiB，保留推荐与最近两个已发布包（集合去重）；不足则预热失败，不逐出保留包。公众 miss 503，不访问 S3、不重定向源站。显式预热/修复合并同制品工作，按尝试预留回源流量，流式落盘验证大小/SHA-256/包名/构建号，fsync 后原子启用。

CLI 固定入口 `node <release>/dist/app-downloads/download-cli.js <command> --env <配置文件>`；不从参数接收密钥。命令：`init-ledger --kind egress|origin`（只创建不存在账本）、`register --manifest <JSON>`、`warm --build <n>`、`repair --build <n>`、`publish --build <n> --published-at <ISO>`、`withdraw`、`pause`、`resume`、`status`、`verify-cache --build <n>`。`warm/repair` 另用 `--origin-env <私有环境文件>`。制品 manifest v1 字段为 `schemaVersion=1,applicationId,versionName,buildNumber,sizeBytes,sha256,bucket,key,legacyUpdateUrl`；publicUrl 由 build 计算。先版本说明预检、登记/鉴权预热，再受限晋级；`publish` 只能在版本说明发布确认后执行。输出只有状态与制品身份。

迁移顺序：兼容网关与发布工具 → 预热现有包 → 切 meta/Web → 旧 APP HEAD+GET 验收 → 独立评审关闭 APK 公共读。只允许 APK 权限变化，不修改图片桶或 RainS3 实例开关；不自动购买流量。

契约提交先交付路由、DTO、响应头和运维约定；文件发送、CLI、隔离测试与安全模板在同分支继续实现。主 API 未注入网关 handler 时这些路由返回 503，不能绕过独立网关。
