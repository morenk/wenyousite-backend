# Flutter / 原生移动端接入

本文定义原生移动客户端需要遵循的 HTTP、安全、重试和推送生命周期。字段与端点以 [`contracts/openapi.json`](../contracts/openapi.json) 为机器事实源；移动端 V1 范围与黄金旅程分别以 [`mobile-v1-operation-coverage.json`](../contracts/mobile-v1-operation-coverage.json) 和 [`mobile-v1-golden-fixtures.json`](../contracts/mobile-v1-golden-fixtures.json) 为准；动态分类、Markdown、站内传送门与 FCM data 继续使用各自独立 fixtures/schema。

界面、字体、文字缩放和页面状态由公开 `wenyousite-foundation` 维护；仓库边界与入口见 [`mobile-ui-contract.md`](./mobile-ui-contract.md)，实际版本以 Flutter 客户端的 `foundation.lock.json` 为准。

正文图片对齐扩展使用 [`markdown-v5-image-alignment-fixtures.json`](../contracts/markdown-v5-image-alignment-fixtures.json) 作为迁移输入。已审查移动端提交 `6b6083bcdb9eecf799d2357d082ad10fc1a28e00` 支持 Markdown v3/v4/v5：独立普通图片块支持左/中/右对齐，收藏表情保留行内继承语义，文字与普通图片混排仍拒绝单独对齐，并已同步编辑器、Delta 编解码和站内剪贴板。服务端 `/meta.markdownContractVersion` 已声明 v5；旧客户端仍按能力门控读取兼容正文。

## 启动、构建兼容与诊断

1. 客户端只从随版本固定的 OpenAPI 生成 API/model 代码，不在构建时下载线上 Swagger。
2. 启动时匿名调用 `GET /api/v1/meta`，读取契约、构建、能力和 `mobileCompatibility` 中当前平台的移动版本策略。
3. 使用 Android `versionCode` 或 iOS `CFBundleVersion` 的正整数构建号比较：
   - `minimumSupportedBuild=null`：不强制升级；否则当前构建号更小时进入阻断升级页。
   - `recommendedBuild=null`：不提示推荐升级；否则当前构建号更小时给出可关闭的升级提示。
   - 更新按钮只使用对应平台的 `updateUrl`，不得在客户端硬编码另一平台地址。
4. 版本策略通过后再检查 `contractVersion`。未知主版本不得继续猜测字段；显示可解释的兼容错误，并使用服务端更新地址引导升级。同主版本新增字段和未知枚举值必须安全降级。
5. 响应的 `X-Request-ID`、`X-API-Contract-Version` 和 `/meta.buildSha` 用于诊断。不得记录 access/refresh token、FCM token、完整私聊正文或私密内容。

服务端未配置移动发布策略时，Android/iOS 的三个字段都显式返回 `null`，不会阻断客户端。部署环境必须让 `buildSha` 等于实际后端 Git 提交。

移动端公网门禁还会精确比较 `backendRevision` 与 `/meta.buildSha`。同步来源应为已部署且可从 `origin/dev` 追溯的提交；分支头可能包含尚未部署的文档提交，不能直接视为运行版本。应从选定提交完整同步契约、fixtures 和元数据并重新生成 SDK，不能只改版本号或 SHA 来绕过检查。

服务端配置映射如下；配置任一构建号时必须同时提供该平台的 HTTPS 更新地址，且推荐构建号不能低于最低支持构建号：

| 平台    | 最低构建号                           | 推荐构建号                         | 更新地址                    |
| ------- | ------------------------------------ | ---------------------------------- | --------------------------- |
| Android | `MOBILE_ANDROID_MIN_SUPPORTED_BUILD` | `MOBILE_ANDROID_RECOMMENDED_BUILD` | `MOBILE_ANDROID_UPDATE_URL` |
| iOS     | `MOBILE_IOS_MIN_SUPPORTED_BUILD`     | `MOBILE_IOS_RECOMMENDED_BUILD`     | `MOBILE_IOS_UPDATE_URL`     |

当前私有测试发布不要求移动端仓库位于 VPS。Android release APK 由开发机通过发布脚本上传到 `wenyou.site`，iOS 由 TestFlight 托管；构建、签名、三版本保留和故障处理见 [`mobile-release-operations.md`](./mobile-release-operations.md)。

### 故障诊断与 Sentry

客户端为 API 请求发送 UUID `X-Request-ID`；服务端接受安全格式的编号，并在成功与业务错误响应中返回同一编号及 `X-API-Contract-Version`。HTTP 日志的 `req.id`、异常日志的 `requestId` 可用于关联移动端记录；编号不是身份凭证或业务幂等键。对象存储直传不经过 API，其请求编号不能保证在后端日志中找到。

移动端使用独立 Sentry 项目，DSN 由 Windows 构建通过 `--dart-define-from-file` 注入。后端 `SENTRY_DSN` 仅配置后端项目，`/meta` 不下发移动端 DSN，已安装且未内置 DSN 的 APK 仍只保留本机记录。仅传入 DSN 也不能证明真实收件，需在设备上核对事件编号、白名单字段和 API 请求编号。当前审查及 Windows 接入步骤见 [移动端诊断接入审查](./mobile-diagnostics-20260906.md)。

## 认证与安全存储

创建原生登录终端的 `POST /auth/login` 和 `POST /auth/register/verify-and-complete` 必须携带：

```http
X-Client-Platform: mobile
```

OpenAPI 为兼容 Web 把该头标为 optional；省略或传未知值会创建 7 天 Web 终端，响应体也不会提供移动端所需的 refresh token。移动端响应体中的 refresh token 有效期为 30 天，每次刷新都会轮转；同一账号允许一个 Web 与一个 mobile 终端并存。

- access token 与 refresh token 存入 iOS Keychain / Android Keystore 封装的安全存储，不使用 SharedPreferences、普通文件或日志。
- 所有受保护请求携带 `Authorization: Bearer <accessToken>`。
- 管理员在移动端行使内容隐藏等客户端权力时继续使用同一普通 access token；`POST /moderation/content/:type/:id/hide` 会实时校验 `ADMIN / SUPER_ADMIN`，不建立站务 Cookie 会话，也不执行邮件 step-up。普通用户收到 `ADMIN_REQUIRED` 时不得显示或重试该能力。
- 多个请求同时收到 `TOKEN_EXPIRED` 时只允许一个 refresh 在途，其余请求等待结果。
- 刷新成功后原子替换两个 token，并只重放一次原请求；刷新失败或重放仍为 401 时停止自动重试。

### 邮箱验证码发送

注册、找回密码和换绑邮箱的发码 POST 不得自动重放。请求成功后进入 60 秒冷却；网络超时、5xx 或 429 也视为投递结果不明，提示“邮件可能已经发出”，保留验证码输入流程并进入同样的 60 秒冷却。服务端会按规范化邮箱/用户与验证码用途原子去重，但客户端冷却仍用于避免在连接断开时持续制造在途请求。客户端不得把邮箱、验证码或凭证写入日志；本规则需在本地 Windows 的 Flutter 实现与测试中落地，VPS 上的移动端仓库保持只读。

### 被处罚账号申诉

普通 access token 在账号暂停或封禁后会返回 `ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED`，不得再用它直接请求申诉接口。申诉流程使用独立且受限的凭据：

1. 用户主动输入账号密码，调用 `POST /api/v1/moderation/appeal-token`。
2. 将响应 `appealToken` 仅保存于当前申诉流程的安全内存或安全存储中；它有效 15 分钟、不可刷新、不替代普通会话。
3. 以 `Authorization: Bearer <appealToken>` 调用 `GET /api/v1/moderation/decisions/mine` 和 `POST /api/v1/moderation/appeals`。普通未受处罚会话仍可使用原 access token 调用同一接口。
4. 收到 `APPEAL_TOKEN_INVALID` 时只清理申诉凭据并重新验证账号；不得因此恢复、清理或刷新普通会话。退出申诉流程后主动清理该凭据。

申诉凭据不得发送给任何其他接口。客户端生成器应把 OpenAPI 的 `bearer` 与 `appealBearer` 两个 security requirement 解释为二选一。

### 401 状态机

客户端按生成的错误码名称分支，不使用数字区间或 `message` 文案：

| 错误                                                                          | 客户端行为                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `TOKEN_EXPIRED`                                                               | 单飞刷新并重放一次                             |
| `TOKEN_INVALID`、`TOKEN_REVOKED`、`TOKEN_THEFT_DETECTED`、`SESSION_NOT_FOUND` | 清除本地会话并重新登录                         |
| `ACCOUNT_DEACTIVATED`、`ACCOUNT_SUSPENDED`、`ACCOUNT_BANNED`                  | 清除 token，展示对应不可用终态                 |
| `ACCOUNT_LOCKED`、`LOGIN_FAILED`、验证码和旧密码错误                          | 展示当前表单错误，不触发 refresh               |
| `APPEAL_TOKEN_INVALID`                                                        | 仅清理申诉凭据并重新验证，不修改普通会话       |
| 未知 401                                                                      | 不循环刷新；清除当前会话并展示通用重新登录状态 |

### 主动退出

退出顺序必须固定：

1. access token 仍有效时，尽力调用 `DELETE /api/v1/mobile/devices/current` 停用 FCM token。
2. 调用 `POST /api/v1/auth/logout`，同时携带 Bearer access token，并在请求体传当前 refresh token，以兼容仍按 token 撤销的旧后端。
3. 无论网络或服务端结果如何，清除本地 token、用户资料与徽标缓存。

新后端优先按 access token 的稳定 `sessionId` 撤销整个终端；Cookie/请求体 token 仅作兼容回退。若 access token 已过期，最多先刷新一次再执行退出；刷新失败时仍完成本地退出，不能形成重试循环。

## 幂等、分页和离线重试

创建主题帖、子贴、楼层/回复、云草稿、动态、动态评论、私聊消息、表情导入和温油打赏时，使用 UUID v4 `clientRequestId`。一次用户操作从首次发送到所有超时重试必须复用同一值；用户明确发起新操作时才生成新值。

- 网络超时不是创建失败，使用原键重试。
- 相同键和相同载荷返回原结果；同键不同载荷返回 `IDEMPOTENCY_KEY_REUSED`，此时停止自动重试。
- 本地待发送记录保存 `clientRequestId + normalized payload + state`，服务端确认后再删除。
- 仅 GET/HEAD、幂等 PUT/DELETE 和携带稳定幂等键的创建请求可自动重试；只处理网络错误与 5xx，原请求之外最多两次并加入抖动。4xx、429、普通 POST/PATCH 和幂等键冲突不自动重试。

合同 `5.7.0-dev.20260823.1` 起，云草稿创建可选携带 `clientRequestId`，并可用 `GET /drafts/state` 原子读取五槽列表和用量；Windows 客户端同步契约后应为每次创建持久化稳定键。覆盖继续使用草稿 ID 与 version 的 PATCH，删除改传 `?version=<当前版本>`；409 时读取最新版并保留本机正文，不得自动强制覆盖。兼容期旧调用仍可省略新增字段。

`meta.cursor` 是不透明字符串。筛选或排序变化时清空 cursor；收到 `INVALID_CURSOR` 时清空列表并从首页加载。合同 `5.13.1-dev.20260827.1` 起，动态发现与关注流共用“最后未删除评论时间，没有评论则动态发布时间”的顶帖顺序；点赞、收藏、加油和编辑不顶帖。旧发现快照和关注流 cursor 升级后会失效，现有 `INVALID_CURSOR` 首页重载逻辑即可兼容。收到 `RATE_LIMITED` 时遵守 `Retry-After` 并加入随机抖动。

合同 `5.5.0-dev.20260822.1` 起，`postsFindFloors` 可传 `authorId` 只筛选主楼层。合同 `5.6.0-dev.20260823.1` 向后兼容新增 deferred 的 `postsFindFloorAuthors` 与 `postsFindReplyAuthors`：前者只给出当前子贴实际发布过主楼层的角色作者，后者只给出指定主楼层下实际回复过的角色作者。当前移动端可继续省略新接口并沿用原排序、分页和响应；Windows 后续同步固定 OpenAPI、重新生成 SDK 后，应以这两个范围化目录替代 `threadMembersFindAll` 的整帖候选。应用作者或顺序筛选时清空 cursor 并一次重载首页，主楼层筛选不得在客户端二次裁剪内嵌楼中楼。

合同 `5.14.0-dev.20260829.1` 起，Windows 移动端在独立契约同步切片中固定 OpenAPI、重新生成 SDK，并接入 planned 的 `postsFindLatestInThread`。主题详情的“跳到最新发言”调用该接口后，应把返回的 `id / parentPostId` 交给现有 `ThreadDetailEntryTarget` 与 `threadPostTargetProvider` 定位链路：主楼层注入并聚焦，楼中楼先取得父楼再进入独立回复页，不扫描子贴或分页。按钮使用现有 `navigation.down` 语义图标，覆盖加载、无楼层禁用、404 竞态与当前目标重复点击；应用前清除会遮蔽目标的作者筛选。该后端端点为向后兼容新增，VPS 只审查既有移动代码并维护迁移事实，不修改 Flutter 源码、生成物或测试。

用户公开资料的 `accountStatus` 只用于显示“暂时封禁 / 永久封禁”，客户端不得推算或展示处罚截止时间。主题帖快捷收藏继续只传 `threadId` 即可进入主题帖默认夹；分类管理读取和新建 `/bookmarks/folders`，并使用 `PATCH /bookmarks/:id` 移动。合同 `5.13.0` 起，动态夹与主题帖夹完全独立，读取和新建使用 `/moments/bookmark-folders`，动态收藏按分类读取 `/moments/bookmarks` 并通过 `PATCH /moments/:id/bookmark` 移动；两套目录可分别创建同名条目。旧的无请求体收藏调用继续进入动态默认夹，旧客户端传原共享目录 ID 时后端会兼容映射到同名动态夹。收藏夹名称和本人归类字段只能在本人界面展示。

公开资料可通过 `/users/:id/moment-bookmarks` 展示动态收藏，并与主题帖收藏共同服从 `showBookmarks`。公开接口不得展示 `bookmarkFolderId` 或收藏夹名称；移动端必须在 Windows 环境同步目录拆分契约，把目录仓储、创建入口、筛选和选择器按内容类型拆开，VPS 不修改或生成移动端代码。

合同 `5.1.0-dev.20260817.1` 起，首页、主题帖搜索、收藏及用户主页创建/参与列表都携带同一完整主题帖卡片字段。Windows 开发环境同步 OpenAPI 并重新生成 SDK 后，应让这些入口复用首页卡片 mapper；搜索的 `relevance` 与本人收藏的 `bookmarkId` / `bookmarkFolderId` 仍作为场景附加字段处理。旧客户端可继续忽略新增字段。

合同 `5.9.0-dev.20260823.1` 起，Windows 移动端需在独立契约同步切片中固定 OpenAPI 并重新生成 SDK，然后完成四项接入：使用 `usersGetMyCollaboratedThreads` 展示协作主题列表；按子贴必填 `postingCapability` 禁用发言并展示对应拒绝原因；识别 `thread_collaborator_added/removed` 通知并跳转主题；收到撤销通知或管理写入返回权限错误时退出该主题的管理页并刷新成员及协作列表。VPS 只维护本指南和事实源，不修改或验证 Flutter 实现。

合同 `5.11.0-dev.20260825.1` 起，Windows 移动端必须在独立契约同步提交中固定 OpenAPI、重新生成 SDK，并消费通知目标必填 `state`：仅 `ACTIVE` 允许导航，`CONTENT_DELETED` / `USER_DEACTIVATED` 显示不可点击历史态，`NO_TARGET` 按普通系统通知展示。主题、楼层/回复、动态及评论详情从通知或站内链接打开时必须重新验证；403/404 要清除保留详情和回复编辑器，不得继续显示缓存内容或提交回复。普通 PRIVATE 主题链接对非成员显示统一不存在页；只有有效 `/join/{token}` 先显示最小邀请预览，用户明确加入后才进入详情。管理员隐藏动态主评论时清除其回复子树；作者墓碑仍保留。该 Flutter 代码、测试、生成物与 APK 门禁只能在 Windows 工作区完成，VPS 不修改移动端副本。

合同 `5.11.1-dev.20260825.1` 起，动态主评论的 `order` 不再传入内嵌楼中楼；折叠预览固定返回最早三条，独立楼中楼仍默认 `OLDEST`。当前 Windows 移动端展开列表已经显式传 `OLDEST`，同步固定 OpenAPI、重新生成 SDK 并更新 moments 模块文档后无需修改业务排序逻辑；VPS 不修改或验证 Flutter 实现。

合同 `5.12.1-dev.20260826.1` 起，主题删除、点赞和取消点赞在读取主题状态前统一校验可见性；不存在、他人草稿和 PRIVATE 非成员都返回 HTTP 404 / `THREAD_NOT_FOUND`，可见但非楼主的删除仍为 403，楼主操作本人草稿的点赞入口仍为 400。响应结构没有变化；Windows 移动端下一次契约同步时固定新版 OpenAPI 并重新生成 SDK，继续沿用现有 403/404 清理详情与编辑状态的行为即可。邀请、提及、通知和媒体 URL 行为不变，VPS 不修改或运行 Flutter 门禁。

## 媒体、Markdown、动态与温油

### 编辑器 v7 Windows 迁移

本次只读审查固定移动端 `9d6a7c4e29cc20c080ffa47ac18aa2736c3d518e`。后端空段校验修复已在 `8f646f0cc872e1f19a1dd3388fd98fcbd16f1696` 交付；本节和 v7 语料所在的后端提交是后续同步基线（用 `git log -1 -- contracts/markdown-editor-roundtrip-v7-fixtures.json` 解析完整 SHA）。API 仍为 `5.18.0-dev.20260905.1`，`/meta.markdownContractVersion` 仍为 5。旧客户端请求兼容，但该移动端 SHA 仍存在输入来源属性导致的行内序列化分片风险，不能视作端到端修复完成。

Windows 待办：

1. 从已提交后端同步 round-trip v7 与图片对齐 fixture revision 2，更新消费者和契约门禁；不改 HTTP SDK，不另创正文存储格式。v7 的字段和样式顺序以 [编辑操作契约](modules/markdown-content.md#编辑操作契约-v7) 为准。
2. 在 `MarkdownDeltaCodec` 的公共行内编码路径修复逻辑区间合并。`LiteralTextQuillController.replaceText` 会为新输入加 `wenyou_literal_text`，旧文字没有该属性；不能按完整 Delta attributes 是否相等逐片包裹格式。仅在可见 marks 和链接目标相同的连续文字间合并，逐片完成必要字面转义后再包一次定界符；换行、embed、真实样式变化必须分界，未知属性继续拒绝，代码/首尾空白沿用各自规则。
3. `_tryDecodeRichLine` 的重编码证明不能要求历史源码与规范序列化逐字相同。以文字、完整 marks、块属性、节点身份的语义等价证明安全，再规范写回；不能直接删除证明或把解析成功当作无损。
4. 公共 encode 写出前增加无损检查：结果重新解码后，与原 Delta 在合并相邻等价片段、忽略已知输入来源元数据后语义一致。文字、空段、软换行、对齐、链接目标和原子节点身份不得忽略。解码内部已有编码证明，须保留不递归的内部路径，避免 encode → decode → encode 无限递归。失败走现有错误/诊断通道、保留草稿、不发提交，不记录正文、链接或隐藏身份。
5. 逐条用真实 `LiteralTextQuillController` 输入消费 48 条 `editCases`：首/中/尾光标明确启用 fixture marks，检查文字、逐段样式、规范输出、重开幂等和删除恢复；另消费五类 `inlineInsertTexts`，覆盖引用内连续粗体、软换行、空段与对齐标题/图片相邻。验证不同来源但同样式能合并，不同链接/样式与原子节点不能误合并。
6. 在 Windows 运行移动端仓库门禁、构建签名 APK，并以专用账号验证“Web 创建 → 移动插空段/改格式 → Web 重开”和反向旅程，清理可识别测试内容。通过后再推荐 build 94（不提高最低版本）；本次 VPS 不修改发布推荐、不执行 Flutter 门禁、不改写用户原帖。若 build 94 已被其他任务发布，使用下一个未发布构建号。

### 媒体与正文接入要求

- 上传遵循“预签名 PUT → `upload-done` → 查询状态”；仅在 `COMPLETED` 后使用衍生图，列表优先 `thumbnailUrl`，详情优先 `mediumUrl`，为空或失败时回退 `url`。不得猜测对象键。
- 个人主页背景包含根级 Web 3:1 资产和可空 `mobile` 2:1 资产；移动端优先选择 `mobile`，历史数据为空时回退根级资产，整体为 null 时不预留背景舞台。双画幅设置与移除仍是 planned，客户端实现前也必须消费 `mobile-v1-golden-fixtures.json` 的 `profileCovers` 旅程。
- 主题帖、楼层和回复使用 Markdown v5 工具栏能力白名单。客户端必须消费 [`markdown-v4-fixtures.json`](../contracts/markdown-v4-fixtures.json)、[`markdown-v4-nodes-fixtures.json`](../contracts/markdown-v4-nodes-fixtures.json)、[`markdown-editor-roundtrip-v7-fixtures.json`](../contracts/markdown-editor-roundtrip-v7-fixtures.json)、[`markdown-v5-image-alignment-fixtures.json`](../contracts/markdown-v5-image-alignment-fixtures.json) 与 [`editor-clipboard-v2-fixtures.json`](../contracts/editor-clipboard-v2-fixtures.json)，覆盖规范化、允许/拒绝、字面文本降级、扩展节点、普通软换行、块语义、块对齐、图片块对齐、行内边界语义和剪贴板 round-trip；第三方解析器支持的表格等语法不得自行扩大产品能力。v6 继续保留 Setext H2/分隔线和行内定界符边界规则；写回仍以字符引用保护相邻正文、不增加可见空格，并把下划线定界符规范为星号。
- Windows 移动端必须固定 Foundation `v6.7.0`，把 `align` 加入 Delta 行属性白名单，并让 Markdown→Delta Codec 为普通段落、H2/H3 和 v5 独立普通图片块解码、编码紧邻的 `center|right` 标记；左对齐删除标记。工具栏以单一“对齐”入口在更多面板切换左/中/右，阅读器按块应用一致排版；列表、引用、分隔线和协议空段不得继承属性，文字与普通图片混排不得独立对齐，提及、骰子和收藏表情随父段落。已审查提交 `6b6083bcdb9eecf799d2357d082ad10fc1a28e00` 同时接受服务端版本 3、4、5，`/meta.markdownContractVersion` 现已激活为 5。
- Windows 同步 clipboard v2 后，阅读态系统任意选区继续只写可见纯文本；楼层/回复整篇菜单必须经现有 Markdown→Delta Codec、`WenyouEditorClipboardStore` 与原生 marker 通道写入结构，并同时写可见文本 fallback。Store 的匹配键可使用可见文本、随机 marker、登录会话和十分钟有效期，但不得用编码后的 Markdown 覆盖系统 fallback；普通格式定界符、对齐标记、传送门目标、用户 ID、骰子 ID 和媒体 URL 都不能进入由客户端生成的纯文本。站内 v2 片段保留合法块对齐，v1 片段按既有结构读取但没有对齐；外部 HTML/CSS/纯文本不推断对齐。传送门、用户提及、`@全体玩家` 和骰子表达式保留；骰子粘贴换新 ID 且不继承结果；阅读端图片/表情分别降级为 `[图片]` / `[表情]`。marker 过期、进程重启、跨应用、Web↔Android 和跨设备均静默退回纯文本。参数化测试必须逐条消费 clipboard v2 的 entry points、alignment rule、node rules、transport/fallback 规则和 golden cases；VPS 不修改 Flutter 源码或声称已运行移动端门禁。
- 动态标题保持纯文本；动态正文、评论和私聊正文仍是字符串，不进入通用 Markdown 渲染链路，但应消费 [`internal-reference-v1-fixtures.json`](../contracts/internal-reference-v1-fixtures.json)，只识别 `[名称](合法站内坐标)` 与裸站内坐标。输入接受 `wenyou.site`、`www.wenyou.site` 和相对坐标并规范化为相对地址；`post + subthread` 以 `post` 为准，转义名称与裸地址边界以 fixture 为准。其他 Markdown/外链保持字面文本。传送门同页导航、目标不可见时交给既有详情错误态，不预取目标元数据。
- 编辑器必须消费站内传送门 fixture 的 `editorPasteCases`：剪贴板纯文本整体是一个合法坐标时，以当前选区文字或默认名称“传送门”插入规范化相对链接并立即显示为传送门；混合文本、站外地址、非法邀请 token 及带查询参数的邀请沿用普通粘贴。邀请 token 是访问凭据；除用户明确保存的正文或草稿外，不得把它写入日志、诊断、分析事件或独立缓存，也不得用于预取私密帖元数据。
- 私聊会话列表消费 `directMessagePreviewCases`：普通传送门显示名称，邀请或残留 `/join/{token}` 统一显示“邀请传送门”。完整消息与复制使用原始字符串；私聊邀请不弹公开分享确认，公开主题、楼层、回复、动态和评论则在内容首次提交或邀请内容变化后确认。
- 动态最多九张图片；评论可使用文字、单张图片或单个收藏表情，图片与表情互斥。
- 合同 `5.15.0-dev.20260902.1` 新增 `stickersImportMomentImage` 与 `stickersImportMomentCommentImage`：原图查看页分别提交 `momentId + mediaId` 或 `momentCommentId + mediaId`，并沿用同一 UUID v4 `clientRequestId` 重试、轮询既有 `StickerImportResponseDto`。Windows 移动端同步 OpenAPI 并重新生成 SDK 后，把动态正文和评论接入现有“图片操作”菜单；父动态 404 使用 `MOMENT_NOT_FOUND`，评论来源 404 使用 `STICKER_NOT_FOUND`。VPS 只维护后端契约，不修改 Flutter 源码、生成物或测试。
- 合同 `5.10.0-dev.20260823.1` 起，图片签名请求可选传业务 `purpose`；Windows 移动端应在独立契约同步切片中为头像、主页背景、私聊、动态、动态评论、正文和表情来源分别传对应枚举，并使用响应中的 `animated` 与非空派生 URL。静态图片在选图后应先旋转归正、最长边缩至 2560px、清除元数据并编码为 WebP（质量约 85）再直传；GIF 不在客户端转码。旧版本省略 `purpose` 仍由后端按 `LEGACY` 兼容，后端还会再次标准化且不会长期保存静态原件。VPS 只维护契约和迁移说明，Flutter 实现与门禁留给 Windows。
- 动态楼中楼只有两层视觉结构；筛选回复者时仍保留所属主评论上下文。未知作者、删除媒体和未知枚举都必须安全降级。
- 动态通知目标携带 `momentCommentId` 时，详情页调用 `momentsCommentContext` 直接取得 `root`、`target` 和当前可见 `replyCount`。主评论目标直接注入并定位；楼中楼目标同时注入所属主评论和目标回复、展开后定位，不扫描评论或回复分页。主评论已删除但目标回复仍可见时保留服务端墓碑；404 保留动态详情与普通评论且不自动重试，临时失败保留内容并允许重试。客户端必须消费 `mobile-v1-golden-fixtures.json` 的 `momentCommentNavigation` 旅程。
- 合同 `5.8.1-dev.20260823.1` 起，动态卡片可返回 `canInteract=false`，表示已注销作者的可读历史动态。新客户端应禁用新增点赞、评论、收藏、移动收藏和加油，保留取消已有点赞/收藏及有权删除评论的入口；字段缺失时按 `true` 兼容旧服务。合同 `5.13.1-dev.20260827.1` 已移除发现快照专属 503 路径，两种主 Feed 的 `40007` 都清空游标并从首页刷新。相关 UI/SDK 或模块文档变更只能在 Windows 移动端工作区实现，VPS 审查副本不做修改。
- 合同 `5.8.0-dev.20260823.1` 起，主题帖分类来自 `GET /thread-categories`，保存稳定 `slug`；草稿可为空，发布前选择启用项。Flutter 必须消费 [`thread-category-v3-fixtures.json`](../contracts/thread-category-v3-fixtures.json)：现有线程直接显示响应 `categoryInfo.name`，不再用仅含启用项的发现列表反查；停用项保留当前名称且不可新选，未知 slug 原值降级，空值显示“未分类”。分类是纯文本能力，客户端不得消费兼容字段 `icon / mergedIntoId`，也不得复制任何现有 slug、名称或分类数量为枚举/回退常量。旧客户端继续读取原 `category`，新增字段由生成模型按未知字段兼容策略忽略。
- 每日启动可调用 `POST /wallet/check-in`；只有 `claimedNow=true` 时展示本次领取。所有温油金额都是十进制整数字符串，不转换为浮点数；打赏继续复用稳定幂等键。
- 合同 `5.12.0-dev.20260826.1` 起，新建 `reply` 通知 payload 可选携带 `replyTargetUserId/replyTargetName`。Windows 移动端必须在独立契约同步提交中固定 OpenAPI、重新生成 SDK，并修改通知展示：目标 ID 等于通知 `userId` 时显示“发送者 回复了你”，否则显示“发送者 回复了目标用户”；历史通知或字段不完整时安全降级为“发送者 回复了”，不得再把所有 reply 指向当前用户。通知链接、分类与接收范围不变；VPS 不修改或验证 Flutter 实现。
- 合同 `5.12.2-dev.20260826.1` 起，楼中楼的管理者/订阅来源通知使用既有 `new_post` 类型与开放式 `payload.action=new_reply`，完整兼容正文为“发送者 发布了楼中楼回复：预览”；直接被回复者仍使用 `reply/action=reply`，同一用户只保留最高优先原因。当前移动端遇到未知 action 会安全显示后端完整正文；Windows 下次契约同步时应固定新 OpenAPI、重新生成 SDK，并可显式把 `new_reply` 显示为“发布了楼中楼回复”。创建回复时 `replyToPostId` 必须与 `parentPostId` 同时提交且属于同一主楼层，现有生成请求已符合该不变量。VPS 不修改或验证 Flutter 实现。
- 合同 `5.12.3-dev.20260826.1` 起，他人发表新主楼层时，主题楼主收到 `type/action=reply`，`replyTargetUserId/replyTargetName` 指向楼主；现有展示会自然显示“发送者 回复了你”并归入互动，目标仍是该主楼层。非作者协作者和实际订阅者继续收到 `new_post` 并归入订阅，子贴正文和 5.12.2 的楼中楼分流不变。Windows 移动端只需在下一次契约同步提交中固定 OpenAPI 并重新生成 SDK，无需修改现有主楼层通知展示或导航；VPS 不修改或运行 Flutter 门禁。

## FCM 设备与消息生命周期

推送能力以 `/meta.capabilities.pushNotifications` 为准。关闭时不注册设备，通知页和私聊仍通过 API 工作。

```http
PUT /api/v1/mobile/devices/current
Authorization: Bearer <mobile access token>
Content-Type: application/json

{
  "pushToken": "<FCM registration token>",
  "platform": "android",
  "appVersion": "1.4.0+120",
  "locale": "zh-CN"
}
```

- 登录/刷新成功、FCM token 更新以及系统重新授权通知后调用 PUT；Web 会话不能注册移动设备。
- Android 13+ 显式请求通知权限并建立稳定 notification channel；iOS 在取得用户授权和 APNs token 后再注册 FCM token。
- FlutterFire 接入必须分别处理前台消息、后台 handler、`onMessageOpenedApp` 和 `getInitialMessage` 冷启动路径。前台是否展示系统通知由客户端统一策略决定，不能依赖 FCM 自动行为。
- FCM `data` 的事实源是 [`mobile-push-v1.schema.json`](../contracts/mobile-push-v1.schema.json) 和 [`mobile-push-v1-fixtures.json`](../contracts/mobile-push-v1-fixtures.json)。所有值均为字符串，正文不进入 data。
- 服务端按通知 ID 或会话 ID 折叠消息，TTL 默认 24 小时并由环境配置；客户端不能假设每条推送都会到达。重复、延迟、乱序、折叠和丢失都通过未读数及目标 API 重新拉取收敛。
- `notification` 按 `notificationId` 打开通知目标，找不到时进入通知中心；`direct_message` 按 `conversationId` 进入会话并用 `messageId` 定位。未知版本或 kind 只刷新未读数并进入相应消息中心。
- 本地徽标只是缓存。前台恢复、推送点击和网络恢复时读取服务端未读数；退出时清空本地徽标。

## 接入验收

后端门禁负责 OpenAPI、错误码、完整移动覆盖清单、V1 协议旅程、动态分类、Markdown、站内传送门 fixtures 和 push schema/fixtures。Flutter 必须共同消费这些产物，并为标为 `implemented` 的 operationId 提供运行时代码和自动测试证据。

## 普通回车规则的 Windows 接入

本次只读审查固定为 `e952a23251640bfe537837c6197d7c632ca54197`。从本节所在的已提交后端同步 [回车语料](../contracts/markdown-editor-newline-v1-fixtures.json)，在 Windows 实现：普通正文手动 Enter 建立新排版段并恢复默认左对齐；单层引用逐次回车增加一行且不自动退出。标题和列表保留常规操作。

编解码和阅读须识别单层引用的独占 `> <br />` 为真正空白行，保留首尾及连续数量；引用内单独 `>` 只保留旧段落结构，不增加可编辑空行。禁止通过删除换行、插入不可见字符或放开其他 HTML 达成表面一致。旧编辑器会降级这种引用标记，候选必须先完成更新与双端保存重开验收；不能因 Markdown 版本仍为 v5 就假定旧实现已支持。

### revision 2 同步与 Windows 验收

从本说明所属候选 PR 的完整提交 SHA 同步 `contracts/markdown-editor-newline-v1-fixtures.json`，要求 `version == 1`、`revision == 2`；不得从运行中的 VPS 或未提交源码推断规则。精确 Markdown 与显示兼容策略见 [正文对齐边界](modules/markdown-content.md#普通正文手动-enter-的对齐边界newline-v1-revision-2)。

- 真实输入控制器消费全部 27 条 `editCases`：`operation.offset` 是 anchor 内 UTF-16 偏移，依次发送 `enterCount` 次 Enter；断言 `serialized`、`lines`、`lineAlignments`，续写后再保存重开。新段对齐重置不清除行内粗体、斜体等 marks。
- 普通手动 Enter 必须保存段落边界，不能编码成继承整段对齐的单 LF；已有单 LF 和 Shift+Enter 保持旧段内语义。自动折行只改变布局，不能修改 Delta/Markdown。
- 真正空段仍为 `<br />`；末尾空段继续输入后变成普通段落。不能把 Markdown 源码的分隔空行显示成额外空白行。
- 安全 encode/decode 无损校验必须保留，语义比较必须继续校验换行、段落、对齐、marks、链接和节点身份。不得通过关闭检查或忽略对齐解决失败。
- 手动验证居中和居右正文的 Enter、连续 Enter、续写、自动折行、只对齐新行、实际保存／重开及 Web↔Flutter 交叉编辑；引用、H2/H3、列表应保持既有行为。VPS 不修改、安装或构建移动端，空正文 H2/H3 的编码异常由原 Windows 任务独立处理。

候选只交付 PR，不代表用户已验收；先合并兼容后端契约，再由 Web/Windows 各自完成消费端候选与手动验收。部署仍需负责人另外明确批准。

### 收藏夹计数刷新

契约 `5.20.1-dev.20260911.1` 的 `bookmarkCount` / `momentBookmarkCount` 是该夹当前可见收藏总数，详见 [计数规则](api-contract.md#收藏夹可见数量)。使用服务端数量，不用分页条数推算总数；收藏、取消、移动及内容或权限变化后刷新目录与列表。回归应覆盖隐藏后 0 条与空列表、恢复后重新计入、跨页总数及主题/动态独立目录。同步固定 OpenAPI 后再运行本端生成与测试；原反馈仍须负责人用原账号复验。

### 块边界 v1 Windows 迁移

从本候选 PR 的已提交完整 SHA 同步 [块边界语料](../contracts/markdown-block-boundary-v1-fixtures.json)，固定 `version=1`、`revision=2`、`markdownContractVersion=5`。先规范 CRLF，再统一分析列 0 marker、目标类型/范围、对齐与原始位置，在 Codec 和阅读通用解析/无效降级前应用；列 0 marker 结束列表/引用 lazy continuation，显式嵌套、HTML、围栏/缩进代码及跨行行内代码中的同形源码不得消费。

逐条执行真实 Markdown AST、Delta 编解码、编辑和 clipboard 测试，校验可见行/空白、逐块对齐、稳定保存重开；原文空格/WJ 等布局字符不得被全局清理。后端测试与源码位置仍为本仓证据，不能代替 Windows Flutter 门禁或 Web/Android 负责人验收。保持 v5/HTTP 字段，不迁移已有内容；旧客户端兼容继续保留。

块边界 revision 2：代码保护范围来自真实行内解析器生成的 code_inline，URL/title 里的反引号不会开启保护区。三个 LF 的额外历史空白恢复为空段；空格布局 sourceLines 保留 WJ，visibleText/lines 不包含隐藏 WJ。clipboard 使用 plainTextByPlatform 分别固定 Web/Mobile 已有投影，不修改 v2。

## 富文本多步测试与结果交接

从已提交 Backend 候选 SHA 同步 [编辑行为 fixture/schema 与结果格式](modules/rich-text-behavior.md)，保留原 newline 27 条及 v7 48 条消费。新机器格式只用于合成测试和离线诊断，不进入 HTTP 或正文存储。未知内容需要完整读取与无损证明后才能开放编辑；Markdown 版本号不能代替引用空行和失败保护能力证据。结果比较及发布停止边界见 [交付记录](rich-text-stability-delivery.md)。

## 主贴发言权限接入

消费已提交的主贴发言权限 OpenAPI（版本以 [契约变更记录](../contracts/CHANGELOG.md) 为准）；聚合保存字段及并发语义见 [API 契约](api-contract.md#主贴发言权限的聚合保存)。从默认子贴回填真实权限，楼主与协作者在发布后现有设置页统一保存。沿用相邻招募状态、可见范围的布局与控件，不新增独立卡片、专用弹窗或保存按钮；说明为“仅影响主贴下的发言，子贴权限单独设置。”

消费者须覆盖修改检测、取消/离开提醒、重复提交、失败保留输入、409 冲突和成功后的版本/能力刷新；旧客户端省略字段不会重置权限，其他子贴不受影响。后端兼容版本先于客户端上线，不以服务端检查替代各端完整页面 UI 验收。

### 自定义收藏夹管理

同步 `5.23.0-dev.20260913.1` 的精确后端 Git 契约提交并重新生成客户端类型。主题帖使用 `PATCH/DELETE /bookmarks/folders/{id}`；动态使用 `PATCH/DELETE /moments/bookmark-folders/{id}`，ID 必须来自各自目录。PATCH 传 `{ name }`（trim 后 1–24 字），消费对应收藏夹 DTO；DELETE 消费 `DeleteBookmarkFolderResponseDto` 的 `deletedFolderId` 与 `destinationFolderId`，收藏仍保留。

默认夹不显示重命名/删除入口，服务器同时强制 409；删除前说明收藏将移入默认夹。成功后刷新同类型目录、列表和选择器，删除当前目录时切换到返回的默认夹，清除失效选择；重命名后刷新名称。400 展示名称校验，409 展示冲突并刷新后允许重试，404 刷新目录恢复选择。测试两类型、默认夹保护、重名/越权、空夹与非空夹删除、失败后保留原状态；不要按名称合并目录或取消收藏。本次保留旧客户端协议，无弃用清理；Foundation 沿用既有控件与反馈契约，无需发布新版本。详见[后端契约](api-contract.md#自定义收藏夹重命名与删除)。

Flutter 代码、类型生成和设备回归仅在 Windows 执行；本后端 PR 不声称移动端检查已通过。
