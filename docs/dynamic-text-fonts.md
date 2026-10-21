# 动态字体 v2

HTTP `5.43.0-dev.20261022.2`。正文新增 `data-wenyou-font-v2`，不替换字体 v1、旧目录、旧 manifest 或旧运行策略 v2。本次先提交可同步的契约切片；动态管理与目录运行入口暂返回 `503/50301`，`textFontV2Supported=false`、`textFontV2WriteEnabled=false`。后续持久化、处理与发布验证完成前不得把本切片当作已可发布功能。

## 身份与能力

版本 ID 为 `^tfv_[a-f0-9]{32}$`，家族为 `tff_`、任务为 `tfj_`、目录发布为 `tfc_` 加 32 位小写 hex。版本在处理成功时创建，此后不改源、构建参数、字形或清单。客户端按语法接受构建后新增的 ID，不内置字体名单，也不能把 familyId 写进正文。

读取声明 `X-Text-Font-Version: 2`；所有正文写入 DTO 声明 `textFontVersion: 2`，包括删光字体。2 包含 v1/v2 混合正文支持；同一个 span 只能有一种字体属性，可同时包含颜色 v1，规范顺序为字体、颜色。v1 客户端只获得保留 v1、移除 v2 的安全副本；无能力客户端移除两版。新或原正文含 v2 而写入方不声明 2 时，返回 `409/40019`，防止降级副本覆盖源。颜色、角色提及能力仍单独协商。

`/meta.capabilities.textFontV2Supported` 仅在私有资源网关就绪且固定映射的 28 个版本均已完成导入并有发布记录时为 true（后来停用或撤回不降低就绪状态）。`textFontV2WriteEnabled` 还要求新写开关开启；缺失均按 false。未就绪部署仍支持正文保源与安全降级，但消费者不据此提前切换旧字体加载通道。未知、停用或撤回版本可在已有源中原样保留、重排或移除；禁止新增/重复/扩写。服务端按去重 versionId 批量查询，不逐 span 查库；与正文提交在同一事务复核，状态切换和写入共享有序锁。可粘贴历史已发布版本仍绑定原版本，不转换成当前新版。

机器事实源：[正文 schema](../contracts/markdown-text-font-v2.schema.json)、[正文夹具](../contracts/markdown-text-font-v2-fixtures.json)、[状态及刷新夹具](../contracts/thread-font-dynamic-v2-fixtures.json)。不识别的合法 v2 ID 在读取、草稿保源中保留；404 短缓存与静默降级不等于删除标记。

## 目录与撤回

- `GET /meta/text-fonts/v2?limit=100&cursor=...`：仅返回当前可选版本的轻目录和 PNG 样张，不含全部字体分片。limit 为最多项数，范围 1–200。按**完整成功信封**的 UTF-8 JSON 大小不超过 65536 字节截页，即使少于 limit 也须跟随 nextCursor。
- 首次请求确定 releaseId/revision；游标绑定发布、偏移与 limit。任意发布、停用、撤回后，旧游标返回 `409/40927`，消费者丢弃未完成新快照并从第一页重取；完整旧快照在新快照完成前保留。不得混合分页。排序为发布快照中的 sortOrder、familyId。
- `ETag` 是当前响应数据摘要；`If-None-Match` 命中返回无正文 304。目录和单版本描述符 `Cache-Control: no-cache`，304 也须先读取当前状态。目录修订单调递增，旧响应不能覆盖较新状态。
- `GET /meta/text-fonts/v2/versions/:versionId`：按需查当前状态；已发布但非当前、已停用版本仍返回描述符。未知或未发布为 404；已撤回返回 200 墓碑，三个布尔值 false 且资源引用 null。描述符和运行策略完整信封均不得超过 65536 字节。
- `GET /meta/text-fonts/v2/versions/:versionId/assets/:asset`：asset 为 `sha256.format`，必须属于该版本已验证清单。所有字节从本站网关读取；对象内容不可变，但授权可撤回，响应 `no-cache`。已撤回为 `410/41001`，不得直接公开可绕过状态校验的对象存储路径。只读公开已发布输出，不公开源文件或暂存路径。

| 版本状态 | selectable | pasteAllowed | renderAllowed |
| --- | --- | --- | --- |
| 当前启用版本 | true | true | true |
| 启用家族的历史已发布版本 | false | true | true |
| 停用家族的已发布版本 | false | false | true |
| 已撤回版本 | false | false | false |

撤回不可逆，客户端收到明确撤回后立即停止该版本呈现/下载并保留源，后续过期响应与离线缓存不能复活它。离线无法感知尚未收到的撤回；网络失败保留最后可信元数据。此机制不声称能收回已交付的字节。发布新版和回滚只改变未来选择，不改历史正文 ID。历史产物不自动删除。

## 分片与运行策略

单版本清单见 [manifest v2 schema](../contracts/thread-font-manifest-v2.schema.json)，完整文件最大 4194304 字节；描述符预告 SHA/bytes/format，下载前按实际 bytes 预留，不套用未知元数据的 64 KiB 预留。清单是原始 JSON 资源，没有 API 信封。每个资源描述符 `{sha256,bytes,format}` 通过描述符中的本站 `assetBasePath` 加 `sha256.format` 解析；禁止任意外链或文件路径。清单不含可撤销状态。

每片同时提供 WOFF2 和 SFNT（ttf 或 otf），携带真实 cmap 覆盖区间、唯一 family 与布局闭包。区间是递增、不重叠的 Unicode 标量范围；不得把缺字标记为覆盖。分片间不能重叠；shards 的覆盖并集等于 coverage，codepointCount 必须一致。web.format=woff2，mobile.format=ttf/otf，specimen.format=png，notices.format=json。解析后核验范围、大小、hash、唯一 shard id/family；总资源不应超出处理预算。字体名不直接用作 CSS family。新构建使用 `WYF2-32hex-shard`；经来源清单和资源 SHA 核验的 v1 导入保留原有 `WYF1-16hex-shard` family、SFNT/WOFF2 字节和 SHA。两种名称均是有效 v2 清单 family，不得把导入资源重新取别名。`baseWeight=400/baseStyle=normal` 表示输出规范样式，变体源先实例化默认轴，原始授权及来源进入 notices。

新策略独立端点 `GET /meta/text-fonts/v2/runtime-policy`，`policyVersion=3,fontVersion=2`，见 [schema](../contracts/thread-font-runtime-policy-v3.schema.json) 与 [默认策略](../contracts/thread-font-runtime-policy-v3.json)。**旧** `/meta/text-fonts/runtime-policy` 继续是绑定固定 manifest 的 v2，不得用动态形状覆盖。

Web 无固定家族数限制，活动预算 64 faces/16 MiB SFNT，使用 lease/LRU；只在实际解除注册和释放引用后归还。Mobile 原生 `(assetSHA,family)` 账本在 engine 生命周期只追加，1024 个键/64 MiB 输入，调用前记账，失败保留收费并隔离该键；目录刷新、回滚、撤回、网络窗口更新不清账。上限耗尽静默默认字体，不提示重启、不伪造卸载。服务器只能收紧本地上限。磁盘缓存独立 64 MiB，不意味着释放原生内存。

网络仍用滚动 60 秒窗口：Web 64 请求/16 MiB/并发 2，Mobile 64 请求/24 MiB/并发 1。从实际发起开始仅非空数据块续期 15 秒 idle，独立 10 分钟总截止；排队不计时。失败及重试计预算，资源级 full-jitter 退避及 Retry-After 与旧策略一致。目录、描述符、样张、清单、notices 均计请求和字节。新目录不重置网络、退避、原生注册账本。

每 5 分钟、前台恢复、选择器打开重验证；未知版本触发合并的按版本查询，404 负缓存 30 秒，暂时故障静默重试并保留最后可信值；已知撤回优先。多个窗口共用运行时与 in-flight 请求。同会话收到新目录后可直接选择新 ID，无须重启或更新客户端。

## 管理与处理

全部 `/admin/text-fonts` 使用既有管理员 Cookie、ADMIN/SUPER_ADMIN 和写操作 CSRF；紧急撤回额外 AdminStepUp。返回 DTO 和字段以 [OpenAPI](../contracts/openapi.json) 为准。

1. `POST /admin/text-fonts` 新建家族草稿；`PATCH /:familyId` 用 expectedFamilyRevision 修改下一次源上传的配置。name、designLanguage、sortOrder、author、sourceUrl、licenseName、licenseText、specimenText 与三项 rights 为完整配置。sourceUrl 仅记录出处，禁止服务器抓取；缺材料可保存草稿。
2. `POST /:familyId/sources?format=ttf|otf&expectedFamilyRevision=N`，`application/octet-stream` 原始单文件，最大 67108864 字节。私有暂存并绑定当次配置快照，返回 draft job。API 不解析字体；不接受 ZIP/TTC、彩色字体或 URL 拉取。
3. `POST /jobs/:jobId/process` 检查作者、来源、授权正文及 distribution/conversion/subsetting 三项权利。缺失返回 `409/40929` 并保留 draft。独立 Worker 从 Outbox/BullMQ 幂等领取；并发 1，非 root、无网络、隔离文件系统、2 GiB、墙钟 10 分钟。变量字体按默认轴实例化，保留 shaping/layout 所需字形，拒绝禁止嵌入/子集化的源。
4. `GET /jobs/:jobId` 返回 draft/queued/processing/ready/failed。处理去重键为 sourceSHA+规范构建参数+固定工具链；相同输入重跑不生成重复产物/版本。失败只返回固定 failureCode，无路径或解析器原始异常。成功创建不可变版本，**不会自动发布**。
5. `GET /versions/:versionId/preview` 及管理资产网关预览；公开未发布版本为 404。`GET /:familyId` 返回家族、jobs、versionIds；列表以 after/limit 分页。
6. `POST /:familyId/publish` 指定 versionId、expectedFamilyRevision、expectedCatalogRevision。先验证全部输出可读/匹配 SHA，再在事务内切换当前版本、创建目录 release/items 和审计；CAS 冲突 `409/40928`。同一入口指定较旧版本即回滚未来选用。家族配置修改不改已有版本快照；新发布才更新目录排序。
7. `PATCH /:familyId/enabled` 同时提供两项 expected 修订；`POST /versions/:versionId/withdraw` 提供 expectedCatalogRevision 和 reason。状态、目录、审计原子提交。写正文、发布、停用、撤回以共同锁顺序串行化，不能用事务外权限查询作为最终准入。

持久化边界：family 保存可编辑草稿和当前版本指针；job 保存私有源身份、配置快照、幂等处理状态；artifact 保存按 buildKey 去重且不可变的产物身份；version 将 family 绑定至不可变 artifact/配置并保存发布时间与撤回墓碑；catalog head/release/items 保存单调修订、原子发布快照；审计复用不可修改 AuditLog。不得通过清空表、覆盖历史对象实现导入或回滚。

[28 款导入映射](../contracts/thread-font-v1-import-map.json) 固定来源 manifest SHA，仅供可重跑导入；不成为动态查询白名单。导入逐对象验证来源清单、SHA、长度及原 family，保留 `(assetSHA,family)`。v1/v2 在同一运行时共用注册账本，先读 v1 再读导入 v2 不产生新增原生注册或重复收费；不允许只按 SHA 合并不同 family，也不允许重置账本。共享零新增注册夹具是消费者必须执行的输入，不代替 Android 原生证据。小城保持 retired；v1 正文/资源不删除、不改写成 v2。

## v1 导入后的撤回边界

客户端在本会话首次确认 `textFontV2Supported=true` 后，已映射的 v1 ID 一律通过固定映射查询 v2 单版本状态，下载也一律使用 v2 描述符的本站网关。之后 `/meta` 为 false、字段缺失、暂时故障或旧响应均不得切回 v1 manifest；已知撤回墓碑即使能力降级也持续优先。仅 `WriteEnabled=false` 不影响读取和撤回状态刷新。正文仍保存原 v1 标记，不改成 family 当前版本。未映射的 retired 小城保源并静默默认字体，不重新加载其历史资源。

状态控制同时覆盖 v1/v2 标记和已注册字形的使用。停用仍允许历史呈现但禁止新选/粘贴；撤回立即停止新下载和两种标记的字体呈现，保留原文。原生账本不回退、已加载资源不声称卸载；只将呈现切回默认字体。资源字节和 family 相同也不能绕过版本状态检查。

没有可信状态时，未知、404、网络失败均静默默认字体，不能回退旧 manifest、旧公共 URL 或仅凭磁盘字节恢复。404 负缓存 30 秒。临时失败或 404 不抹掉最后可信的已发布/停用状态，可继续按该状态使用已有缓存；已知撤回墓碑优先于错误、旧修订和离线数据。后续有效较新描述符才能更新非墓碑状态，明确撤回不可复活。共享夹具 `legacyRoutingCases` 给出两端必须覆盖的状态与零旧 manifest 请求断言。

后端对已完成导入的旧 v1 ID 新增范围也使用对应固定版本的停用/撤回状态，和正文提交同事务验证。原有 v1 正文允许保源、重排或移除，不通过改变映射逃避撤回。

**旧客户端的技术限制**：只实现 v1 的客户端仍可能通过已发布公共 URL、缓存或已加载字形呈现旧字体；v2 网关撤回不能收回这些字节，也不能立即关闭旧 CDN URL。此次不删除旧资源或协议，不宣称所有历史 v1 已立即撤回。兼容后端须先完整导入并验证 28 款资源，再开放 v2 能力宣告，然后才切换支持上述映射的消费者。

## 验收与交接

运行实现需提供已提交的独立 E2E 入口，由单一任务登记 PG、Redis、暂存/输出目录、API/资产地址及清理所有者。消费者构建后，通过真实 Admin 上传→处理→预览→发布生成新 ID，验证同会话选择、发帖、复制、保存和重开。用第二份可辨别字形构建新版，旧帖继续旧版本；覆盖停用、撤回、回滚、离线、旧端保护及失败重试。不得直接 DB 种入 manifest 代替上传链路，也不得复用公网写入。

Web 明暗/窄屏截图及 Android 同会话网络/剪贴板/内存证据由消费者任务提供。当前契约切片仅提供共享固定夹具和保源回归，不宣称这些运行路径已验收。
