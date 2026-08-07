# Flutter / 原生移动端接入

本页描述 Flutter 客户端必须遵循的跨端协议。字段和端点的唯一机器事实源是 [`contracts/openapi.json`](../contracts/openapi.json)；本文只补充 OpenAPI 无法完整表达的生命周期、存储与重试规则。

## 启动与兼容检查

1. 客户端构建时从仓库内固定版本的 OpenAPI 生成 API/model 代码，不在构建过程中访问线上 Swagger。
2. 启动时匿名调用 `GET /api/v1/meta`，读取 `contractVersion`、`markdownContractVersion`、`buildSha` 和能力开关。
3. 客户端应声明自身支持的契约主版本。遇到未知主版本时进入可解释的升级页；同主版本内的新增字段和未知枚举值应安全降级。
4. 每个响应都有 `X-Request-ID` 和 `X-API-Contract-Version`。崩溃报告记录这两个值，排障时不得记录 access/refresh token、FCM token 或完整私聊正文。

## 认证与安全存储

创建登录终端的 `POST /auth/login` 和 `POST /auth/register/verify-and-complete` 必须携带 `X-Client-Platform: mobile`。OpenAPI 为兼容旧 Web 客户端仍把该头标为 optional，不代表 Flutter 可以省略；省略或传入未知值会被服务端归为 `web`。服务端允许同一账号同时存在一个 Web 终端和一个原生移动终端，并向移动端响应体返回有效期 30 天、每次刷新都会轮转的 `refreshToken`。

- access token 与 refresh token 存入 iOS Keychain / Android Keystore 封装的安全存储；不要使用 SharedPreferences、普通文件或日志。
- 所有受保护请求携带 `Authorization: Bearer <accessToken>`。
- 多个请求同时遇到 `40101 TOKEN_EXPIRED` 时，只允许一个刷新请求在途；其余请求等待并复用结果。
- 刷新成功后先原子替换两个 token，再重放一次原请求。刷新失败、重放仍 401，或收到 `40103`～`40106` 时清除本地会话并进入登录页。
- `40105 ACCOUNT_LOCKED`、`40106 ACCOUNT_DEACTIVATED`、`40107 EMAIL_NOT_VERIFIED` 等应按生成的错误码展示专用状态，不以 `message` 文案做程序分支。
- 用户主动退出时先调用 `POST /auth/logout`，再删除安全存储；无论网络结果如何，本地都应完成退出。

## 幂等创建与离线重试

创建主题帖、子贴、楼层/回复、私聊消息和表情导入都使用 UUID v4 `clientRequestId`。一次用户操作从首次发送到所有超时重试必须复用同一个值；用户明确再次点击“新建”才生成新值。

- 网络超时不能视为创建失败，应使用原键重试。
- 相同键和相同载荷返回原创建结果，不产生重复内容或重复通知。
- 相同键复用于不同载荷返回 HTTP 409 / `40912 IDEMPOTENCY_KEY_REUSED`；此时停止自动重试并创建新的用户操作。
- 建议本地待发送记录保存 `clientRequestId + normalized payload + state`，直到服务端确认。不得在每次重试前重新生成 UUID。

## 分页和重试

`meta.cursor` 是不透明字符串。第一页不传 `cursor`，后续页只原样回传服务端最后一次响应值，不进行 base64 解码、加一或 CUID 假设。筛选条件或排序方式变化时必须清空 cursor。

收到 `40007 INVALID_CURSOR` 时清空当前列表并从首页重载。收到 `42900 RATE_LIMITED` 时优先读取 `Retry-After`，叠加随机抖动后再试。仅 GET、幂等 PUT/DELETE 和携带稳定 `clientRequestId` 的创建请求可自动重试。

## 媒体与 Markdown

上传沿用“预签名 PUT → `upload-done` → 查询状态”流程。只有 `status=COMPLETED` 才使用衍生图：列表优先 `thumbnailUrl`，详情/预览优先 `mediumUrl`，字段为 `null` 或加载失败时回退 `url`。客户端不得从原图 URL 猜测 `_thumb.webp` 或 `_md.webp` 对象键。

Markdown 协议版本由 `/meta.markdownContractVersion` 返回，当前为 v2。Flutter 必须同时运行两层语言无关语料：[`markdown-v2-fixtures.json`](../contracts/markdown-v2-fixtures.json) 验证 `canonical` 与 `visible`；[`markdown-v2-nodes-fixtures.json`](../contracts/markdown-v2-nodes-fixtures.json) 验证提及、`@全体玩家`、骰子、表情、普通图片的 parse / serialize / round-trip、代码与转义边界以及复制身份规则。原始 HTML 默认禁用；外链协议仅允许明确白名单。

## FCM 设备注册

推送能力以 `/meta.capabilities.pushNotifications` 为准。它关闭时不注册，通知页仍可通过 API 正常使用。

```http
PUT /api/v1/mobile/devices/current
Authorization: Bearer <mobile access token>
Content-Type: application/json

{
  "pushToken": "<FCM registration token>",
  "platform": "android",
  "appVersion": "1.4.0",
  "locale": "zh-CN"
}
```

- 登录/刷新成功、FCM token 刷新以及系统重新授权通知后调用 PUT；接口按当前 mobile 登录终端 upsert。
- Web 会话不能注册移动推送。服务端退出/替换该 mobile 登录终端后不会继续投递。
- 关闭通知权限或退出登录前调用 `DELETE /api/v1/mobile/devices/current`；服务端对无效 token 会自动停用。
- 推送正文只含通用隐私提示和最小导航数据，不是权威业务内容。FCM `data` 的机器契约为 [`mobile-push-v1.schema.json`](../contracts/mobile-push-v1.schema.json)，黄金样例为 [`mobile-push-v1-fixtures.json`](../contracts/mobile-push-v1-fixtures.json)。
- `kind=notification` 时刷新通知首页并按 `notificationId` 定位；未找到时打开通知中心。`kind=direct_message` 时用 `conversationId` 进入会话并重新拉取消息，`messageId` 只用于定位。未知 `schemaVersion` / `kind` 只刷新未读数并进入对应消息中心，不尝试猜测导航。
- 点击推送后仍通过通知或私聊 API 拉取最新状态；重复、延迟、乱序或未送达都必须可容忍。

## 通知导航与前后台同步

站内通知使用 `payload.schemaVersion` 和 `target.kind` 导航。未知 `type` 或 `target.kind=none` 时只展示 `content`，不要崩溃。应用回到前台、点击推送或网络恢复时刷新未读数/目标会话；本地徽标只是缓存，服务端 API 才是权威状态。

## 发布前最低验证

- 用固定 OpenAPI 生成 Dart 代码并执行 `dart format` / `dart analyze`。
- 用 Markdown v2 的规范化/可见性语料和扩展节点语料运行 Flutter 单测，其中表情必须经过编辑器解析后再序列化验证 round-trip。
- 用 mobile push v1 黄金样例验证 FCM `data` 解析、未知版本降级与隐私字段过滤。
- 覆盖 access token 并发过期、refresh token 轮转、离线创建重试、无效 cursor、媒体处理中 null 变体、FCM token 刷新和推送关闭降级。
- 在测试环境确认错误响应、429 和 5xx 也带请求 ID 与契约版本响应头。
