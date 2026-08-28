# Flutter / 原生移动端接入

本文定义原生移动客户端需要遵循的 HTTP、安全、重试和推送生命周期。字段与端点以 [`contracts/openapi.json`](../contracts/openapi.json) 为机器事实源；移动端 V1 范围与黄金旅程分别以 [`mobile-v1-operation-coverage.json`](../contracts/mobile-v1-operation-coverage.json) 和 [`mobile-v1-golden-fixtures.json`](../contracts/mobile-v1-golden-fixtures.json) 为准；动态分类、Markdown、站内传送门与 FCM data 继续使用各自独立 fixtures/schema。

界面、字体、文字缩放和页面状态由公开 `wenyousite-foundation` 维护；仓库边界与入口见 [`mobile-ui-contract.md`](./mobile-ui-contract.md)，实际版本以 Flutter 客户端的 `foundation.lock.json` 为准。

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

服务端配置映射如下；配置任一构建号时必须同时提供该平台的 HTTPS 更新地址，且推荐构建号不能低于最低支持构建号：

| 平台    | 最低构建号                           | 推荐构建号                         | 更新地址                    |
| ------- | ------------------------------------ | ---------------------------------- | --------------------------- |
| Android | `MOBILE_ANDROID_MIN_SUPPORTED_BUILD` | `MOBILE_ANDROID_RECOMMENDED_BUILD` | `MOBILE_ANDROID_UPDATE_URL` |
| iOS     | `MOBILE_IOS_MIN_SUPPORTED_BUILD`     | `MOBILE_IOS_RECOMMENDED_BUILD`     | `MOBILE_IOS_UPDATE_URL`     |

当前私有测试发布不要求移动端仓库位于 VPS。Android release APK 由开发机通过发布脚本上传到 `wenyou.site`，iOS 由 TestFlight 托管；构建、签名、三版本保留和故障处理见 [`mobile-release-operations.md`](./mobile-release-operations.md)。

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

用户公开资料的 `accountStatus` 只用于显示“暂时封禁 / 永久封禁”，客户端不得推算或展示处罚截止时间。主题帖快捷收藏继续只传 `threadId` 即可进入主题帖默认夹；分类管理读取和新建 `/bookmarks/folders`，并使用 `PATCH /bookmarks/:id` 移动。合同 `5.13.0` 起，动态夹与主题帖夹完全独立，读取和新建使用 `/moments/bookmark-folders`，动态收藏按分类读取 `/moments/bookmarks` 并通过 `PATCH /moments/:id/bookmark` 移动；两套目录可分别创建同名条目。旧的无请求体收藏调用继续进入动态默认夹，旧客户端传原共享目录 ID 时后端会兼容映射到同名动态夹。收藏夹名称和本人归类字段只能在本人界面展示。

公开资料可通过 `/users/:id/moment-bookmarks` 展示动态收藏，并与主题帖收藏共同服从 `showBookmarks`。公开接口不得展示 `bookmarkFolderId` 或收藏夹名称；移动端必须在 Windows 环境同步目录拆分契约，把目录仓储、创建入口、筛选和选择器按内容类型拆开，VPS 不修改或生成移动端代码。

合同 `5.1.0-dev.20260817.1` 起，首页、主题帖搜索、收藏及用户主页创建/参与列表都携带同一完整主题帖卡片字段。Windows 开发环境同步 OpenAPI 并重新生成 SDK 后，应让这些入口复用首页卡片 mapper；搜索的 `relevance` 与本人收藏的 `bookmarkId` / `bookmarkFolderId` 仍作为场景附加字段处理。旧客户端可继续忽略新增字段。

合同 `5.9.0-dev.20260823.1` 起，Windows 移动端需在独立契约同步切片中固定 OpenAPI 并重新生成 SDK，然后完成四项接入：使用 `usersGetMyCollaboratedThreads` 展示协作主题列表；按子贴必填 `postingCapability` 禁用发言并展示对应拒绝原因；识别 `thread_collaborator_added/removed` 通知并跳转主题；收到撤销通知或管理写入返回权限错误时退出该主题的管理页并刷新成员及协作列表。VPS 只维护本指南和事实源，不修改或验证 Flutter 实现。

合同 `5.11.0-dev.20260825.1` 起，Windows 移动端必须在独立契约同步提交中固定 OpenAPI、重新生成 SDK，并消费通知目标必填 `state`：仅 `ACTIVE` 允许导航，`CONTENT_DELETED` / `USER_DEACTIVATED` 显示不可点击历史态，`NO_TARGET` 按普通系统通知展示。主题、楼层/回复、动态及评论详情从通知或站内链接打开时必须重新验证；403/404 要清除保留详情和回复编辑器，不得继续显示缓存内容或提交回复。普通 PRIVATE 主题链接对非成员显示统一不存在页；只有有效 `/join/{token}` 先显示最小邀请预览，用户明确加入后才进入详情。管理员隐藏动态主评论时清除其回复子树；作者墓碑仍保留。该 Flutter 代码、测试、生成物与 APK 门禁只能在 Windows 工作区完成，VPS 不修改移动端副本。

合同 `5.11.1-dev.20260825.1` 起，动态主评论的 `order` 不再传入内嵌楼中楼；折叠预览固定返回最早三条，独立楼中楼仍默认 `OLDEST`。当前 Windows 移动端展开列表已经显式传 `OLDEST`，同步固定 OpenAPI、重新生成 SDK 并更新 moments 模块文档后无需修改业务排序逻辑；VPS 不修改或验证 Flutter 实现。

合同 `5.12.1-dev.20260826.1` 起，主题删除、点赞和取消点赞在读取主题状态前统一校验可见性；不存在、他人草稿和 PRIVATE 非成员都返回 HTTP 404 / `THREAD_NOT_FOUND`，可见但非楼主的删除仍为 403，楼主操作本人草稿的点赞入口仍为 400。响应结构没有变化；Windows 移动端下一次契约同步时固定新版 OpenAPI 并重新生成 SDK，继续沿用现有 403/404 清理详情与编辑状态的行为即可。邀请、提及、通知和媒体 URL 行为不变，VPS 不修改或运行 Flutter 门禁。

## 媒体、Markdown、动态与温油

- 上传遵循“预签名 PUT → `upload-done` → 查询状态”；仅在 `COMPLETED` 后使用衍生图，列表优先 `thumbnailUrl`，详情优先 `mediumUrl`，为空或失败时回退 `url`。不得猜测对象键。
- 个人主页背景包含根级 Web 3:1 资产和可空 `mobile` 2:1 资产；移动端优先选择 `mobile`，历史数据为空时回退根级资产，整体为 null 时不预留背景舞台。双画幅设置与移除仍是 planned，客户端实现前也必须消费 `mobile-v1-golden-fixtures.json` 的 `profileCovers` 旅程。
- 主题帖、楼层和回复使用 Markdown v3 工具栏能力白名单。客户端必须消费 [`markdown-v3-fixtures.json`](../contracts/markdown-v3-fixtures.json)、[`markdown-v3-nodes-fixtures.json`](../contracts/markdown-v3-nodes-fixtures.json) 与 [`markdown-editor-roundtrip-v5-fixtures.json`](../contracts/markdown-editor-roundtrip-v5-fixtures.json)，覆盖规范化、允许/拒绝、字面文本降级、扩展节点、普通软换行、块语义和行内边界语义 round-trip；第三方解析器支持的表格等语法不得自行扩大产品能力。同步 v5 时除保留 v4 的 Setext H2/分隔线规则外，还必须恢复因标点或符号边界与相邻正文导致严格 CommonMark 留为字面的 `* / _ / ~~` 粗体、斜体、粗斜体和删除线；转义、代码、空白边界和普通单词内下划线不恢复。写回以字符引用保护相邻正文、不增加可见空格，并把下划线定界符规范为星号。VPS 只发布契约和迁移说明，Flutter 实现及门禁留给 Windows。
- 动态标题保持纯文本；动态正文、评论和私聊正文仍是字符串，不进入通用 Markdown 渲染链路，但应消费 [`internal-reference-v1-fixtures.json`](../contracts/internal-reference-v1-fixtures.json)，只识别 `[名称](合法站内坐标)` 与裸站内坐标。输入接受 `wenyou.site`、`www.wenyou.site` 和相对坐标并规范化为相对地址；`post + subthread` 以 `post` 为准，转义名称与裸地址边界以 fixture 为准。其他 Markdown/外链保持字面文本。传送门同页导航、目标不可见时交给既有详情错误态，不预取目标元数据。
- 编辑器必须消费站内传送门 fixture 的 `editorPasteCases`：剪贴板纯文本整体是一个合法坐标时，以当前选区文字或默认名称“传送门”插入规范化相对链接并立即显示为传送门；混合文本、站外地址、非法邀请 token 及带查询参数的邀请沿用普通粘贴。邀请 token 是访问凭据；除用户明确保存的正文或草稿外，不得把它写入日志、诊断、分析事件或独立缓存，也不得用于预取私密帖元数据。
- 私聊会话列表消费 `directMessagePreviewCases`：普通传送门显示名称，邀请或残留 `/join/{token}` 统一显示“邀请传送门”。完整消息与复制使用原始字符串；私聊邀请不弹公开分享确认，公开主题、楼层、回复、动态和评论则在内容首次提交或邀请内容变化后确认。
- 动态最多九张图片；评论可使用文字、单张图片或单个收藏表情，图片与表情互斥。
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
