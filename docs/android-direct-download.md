# Android 存储桶直连下载

新下载入口恢复历史 RainS3 对象直连：Backend 只提供推荐版本与制品身份，浏览器和 APP 直接从存储桶下载，APK 正文不经过自研网关。历史依据为 59dd3c7（RainS3 分发）与 53f9325（网关兼容扩展）。旧网关端点、发布模式、账本与审计保留，待无消费者等清理证据齐全后再独立退役。

## 直连契约 5.37

GET /api/v1/mobile-releases/android/download（operationId=mobileReleasesAndroidDownload）匿名返回标准 envelope，data 为现有 AndroidDownloadInfoDto，响应 Cache-Control: no-store，不签发下载 Cookie。

- available：当前推荐策略指向固定桶 URL，存在该构建已公开说明与 SUCCEEDED 发布记录，APK 大小、SHA-256、版本及路径一致；返回完整 release。
- no_release：未配置推荐构建；不会从历史记录重新推荐。
- unavailable：策略仍指向旧网关、缺失 URL/成功发布记录或制品身份无效；release=null。
- 以上状态 retryAfterSeconds=null。发布记录读取故障返回 503；全局 API 限流仍可返回 429。旧 DTO 的 withdrawn/paused 保留给兼容网关，新入口不生成这两个状态。
- downloadUrl 严格为 https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-<versionName>-<buildNumber>.apk；不接受任意主机、查询参数、片段或重定向别名。新入口不访问存储桶，不因请求触发 HEAD、GET、预热、计次或业务写入；available 代表发布身份匹配，实时对象可用性仍由客户端 HEAD 确认。
- releaseNotesUrl 保持本站 /api/v1/mobile-releases/android/{buildNumber}，其余字段/大小上限与已提交 OpenAPI 一致。

新入口位于主 API 路由，避开已有 Caddy /api/v1/app-downloads/* Unix socket 路由，无需改代理配置或停止网关即可逐端迁移。

## Web 与 Mobile

Web 在用户显式下载操作时查询新信息入口，校验精确主机、路径和版本，再用 credentials: omit 向桶 HEAD；HEAD 成功核对 APK Content-Type、Content-Length、Content-Disposition 文件名以及 x-amz-meta-apk-sha256/application-id/version-name/version-code 后，浏览器原生 GET 同一 URL。禁止先下载完整 Blob、后台预取、失败自动重试或降级旧网关。信息状态、HEAD 失败均就地反馈；HEAD 与 GET 之间仍可能发生对象/网络变化。

桶须允许站点 Origin 的 HEAD，并暴露身份头；不向跨域对象发送本站 Cookie 或认证头。存储响应可使用 public, max-age=31536000, immutable 和 Range，文件名包含版本/构建号，发布后不能覆盖相同对象。HEAD 的对象 ETag 不等同 APK SHA-256。

Mobile 继续使用 /meta.mobileCompatibility.android.updateUrl，先 HEAD 校验上述元数据，再 GET、计算 SHA-256 并校验包身份。恢复直连不增加新的 Mobile 请求，也不强制升级旧 APP；旧 APP 已支持同桶 URL。Mobile 发布工具须将预检与晋级命令的 --gateway 移除，并将制品 publicUrl 恢复为原桶 URL；预检仍读取 confirmedRevision，晋级仍必须携带 --notes-revision，不能绕过说明确认。

新 Web 和 Mobile 不再受网关设备/IP 每日次数、SQLite 字节账本或 4 Mbps 限制；流量、缓存与服务限制由桶承担。桶直连无法撤销已发出的公开对象 URL，撤回只取消后续推荐，不宣称能够召回缓存中的安装包。

## 合并后的切换

1. 合并并经管理入口部署兼容 Backend；本任务不部署、不重启、不改桶权限。
2. 通过原受限 promote-android-release.sh --preflight --version <v> --build <n> 获取确认 revision。
3. 原参数不带 --gateway 执行受限晋级：--version <v> --build <n> --url <原RainS3地址> --size <bytes> --sha256 <64hex> --notes-revision <confirmedRevision>。脚本先验证公开 HEAD 与 .sha256，再执行既有说明/策略/TSV 事务及补偿。同构建允许从精确的历史网关地址切回桶；不同构建地址、元数据不符仍拒绝，不重写历史 promotion/TSV 或 downloadArtifact。
4. 发布完成后 /meta.updateUrl 与新信息入口均直连桶，再切换已合并 Web；Mobile 按下次策略读取恢复直连。状态未切换时新 Web 明确不可用，不偷偷使用旧网关。
5. 只读核验 /meta、新 JSON、桶 HEAD 和版本说明；实际 APK 下载可由负责人验收。旧网关继续供已缓存 URL 的客户端访问，另行评估退役。

现有 --gateway 仅保留兼容/回滚用途，不作为新发布默认。回滚须走已有受限流程与原身份校验，不能清空网关账本、改变桶策略或改写审计。固定部署 SHA、实际桶可达性/CORS 与负责人验收在切换时重新核验，不以本次只读快照替代。
