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
- 多个请求同时收到 `TOKEN_EXPIRED` 时只允许一个 refresh 在途，其余请求等待结果。
- 刷新成功后原子替换两个 token，并只重放一次原请求；刷新失败或重放仍为 401 时停止自动重试。

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
| `EMAIL_NOT_VERIFIED`                                                          | 保留只读会话，引导完成邮箱验证                 |
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

创建主题帖、子贴、楼层/回复、动态、动态评论、私聊消息、表情导入和温油打赏时，使用 UUID v4 `clientRequestId`。一次用户操作从首次发送到所有超时重试必须复用同一值；用户明确发起新操作时才生成新值。

- 网络超时不是创建失败，使用原键重试。
- 相同键和相同载荷返回原结果；同键不同载荷返回 `IDEMPOTENCY_KEY_REUSED`，此时停止自动重试。
- 本地待发送记录保存 `clientRequestId + normalized payload + state`，服务端确认后再删除。
- 仅 GET/HEAD、幂等 PUT/DELETE 和携带稳定幂等键的创建请求可自动重试；只处理网络错误与 5xx，原请求之外最多两次并加入抖动。4xx、429、普通 POST/PATCH 和幂等键冲突不自动重试。

`meta.cursor` 是不透明字符串。筛选或排序变化时清空 cursor；收到 `INVALID_CURSOR` 时清空列表并从首页加载。动态发现流 cursor 绑定服务端快照，快照空闲 15 分钟后失效，客户端刷新即可取得新快照。收到 `RATE_LIMITED` 时遵守 `Retry-After` 并加入随机抖动。

用户公开资料的 `accountStatus` 只用于显示“暂时封禁 / 永久封禁”，客户端不得推算或展示处罚截止时间。主题帖快捷收藏继续只传 `threadId` 即可进入默认收藏夹；支持分类管理的客户端再读取 `/bookmarks/folders`、传可选 `folderId` 并使用 `PATCH /bookmarks/:id` 移动，收藏夹名称只在本人界面展示。

## 媒体、Markdown、动态与温油

- 上传遵循“预签名 PUT → `upload-done` → 查询状态”；仅在 `COMPLETED` 后使用衍生图，列表优先 `thumbnailUrl`，详情优先 `mediumUrl`，为空或失败时回退 `url`。不得猜测对象键。
- 主题帖、楼层和回复使用 Markdown v2。客户端必须消费 [`markdown-v2-fixtures.json`](../contracts/markdown-v2-fixtures.json) 与 [`markdown-v2-nodes-fixtures.json`](../contracts/markdown-v2-nodes-fixtures.json)，覆盖规范化、可见文本、扩展节点和 round-trip。
- 动态标题保持纯文本；正文和评论仍是字符串，不进入通用 Markdown 渲染链路，但应消费 [`internal-reference-v1-fixtures.json`](../contracts/internal-reference-v1-fixtures.json)，只识别 `[名称](站内主题坐标)` 与裸站内主题坐标。其他 Markdown/外链保持字面文本。传送门同页导航、目标不可见时交给既有详情错误态，不预取目标元数据。
- 动态最多九张图片；评论可使用文字、单张图片或单个收藏表情，图片与表情互斥。
- 动态楼中楼只有两层视觉结构；筛选回复者时仍保留所属主评论上下文。未知作者、删除媒体和未知枚举都必须安全降级。
- 主题帖分类来自 `GET /thread-categories`，保存稳定 `slug`；草稿可为空，发布前选择启用项。Flutter 必须消费 [`thread-category-v1-fixtures.json`](../contracts/thread-category-v1-fixtures.json)：重命名后按注册表当前名称展示，未知或停用 slug 显示原值且不可新选，空值显示“未分类”。任何现有 slug、名称、颜色和分类数量都不得复制为客户端枚举或回退常量。
- 每日启动可调用 `POST /wallet/check-in`；只有 `claimedNow=true` 时展示本次领取。所有温油金额都是十进制整数字符串，不转换为浮点数；打赏继续复用稳定幂等键。

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

后端门禁负责 OpenAPI、错误码、197 项移动覆盖清单、V1 协议旅程、动态分类、Markdown、站内传送门 fixtures 和 push schema/fixtures。Flutter 必须共同消费这些产物，并为标为 `implemented` 的 operationId 提供运行时代码和自动测试证据。
