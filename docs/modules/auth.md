# 认证模块

## 概述

用户注册（两步：请求验证码 → 验证码+用户名密码完成注册）、登录、Token 刷新、邮箱验证、修改密码、忘记/重置密码、登出的全流程实现。

**双端登录**：每个账号最多同时保留一个 Web 登录终端和一个原生移动端登录终端。PC 浏览器与手机浏览器都属于 Web 端；同端再次登录会替换该端原有终端，另一端不受影响。改密码、重置密码或注销账号时退出全部登录终端。

## 涉及的模型

| 模型                | 用途                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `User`              | 用户实体（邮箱、用户名、密码哈希、邮箱验证状态、注销时间）                               |
| `EmailVerification` | 统一的验证码记录（注册/邮箱验证/密码重置三种类型），含尝试次数限制                       |
| `RefreshToken`      | 登录终端记录（SHA-256 哈希存 token、`family` 作为稳定终端 ID、`revokedAt` 管理生命周期） |

| 枚举                   | 值                                                       |
| ---------------------- | -------------------------------------------------------- |
| `UserRole`             | USER, ADMIN, SUPER_ADMIN                                 |
| EmailVerification.type | REGISTRATION, EMAIL_VERIFY, CHANGE_EMAIL, PASSWORD_RESET |

## API 端点

| Method | Path                                 | Guard    | 限流          | 描述                                                                                       |
| ------ | ------------------------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/auth/register/request-code`        | Public   | 1/min         | 注册第一步：请求邮箱验证码                                                                 |
| POST   | `/auth/register/verify-and-complete` | Public   | 全局 (20/min) | 注册第二步：验证码 + 用户名密码一步完成注册                                                |
| POST   | `/auth/login`                        | Public   | 全局 (20/min) | 邮箱或用户名 + 密码登录；创建对应端的登录终端                                              |
| POST   | `/auth/refresh`                      | Public   | 全局 (20/min) | 使用 refreshToken 轮转刷新双 Token（含盗用检测）                                           |
| POST   | `/auth/verify-email`                 | AuthRead | 5/min         | 使用 6 位验证码验证当前账号邮箱                                                            |
| POST   | `/auth/resend-verification`          | Public   | 1/min         | 重发验证邮件                                                                               |
| POST   | `/auth/change-password`              | AuthRead | 全局 (20/min) | 修改密码（需提供旧密码），成功后吊销全部 refresh token + 发送通知邮件                      |
| POST   | `/auth/forgot-password`              | Public   | 1/min         | 发送密码重置邮件                                                                           |
| POST   | `/auth/reset-password`               | Public   | 5/min         | 使用验证码重置密码，成功后吊销全部 refresh token                                           |
| POST   | `/auth/change-email/request-code`    | AuthRead | 1/min         | 更换邮箱第一步：校验当前密码后向新邮箱发验证码（换新邮箱会作废旧记录，同邮箱未过期则重发） |
| POST   | `/auth/change-email/verify`          | Auth     | 5/min         | 更换邮箱第二步：验证码确认，更新邮箱、退出全部终端并发送成功通知                           |
| POST   | `/auth/logout`                       | AuthRead | 全局 (20/min) | 退出当前登录终端（Cookie 优先）                                                            |
| GET    | `/auth/sessions`                     | AuthRead | 独立 (60/min) | 获取 Web / 移动端活跃登录终端                                                              |
| DELETE | `/auth/sessions/:id`                 | AuthRead | 独立 (60/min) | 退出指定登录终端                                                                           |

## 请求/响应格式

### 注册第一步：请求验证码

```json
// 请求
{ "email": "user@example.com" }

// 响应（验证码已发送）
{ "data": { "emailSent": true, "codeExpiresIn": 900 } }

// 响应（验证码未过期，未重发）
{ "data": { "emailSent": true, "codeExpiresIn": 420, "message": "验证码已发送，请查收邮箱" } }

// 响应（邮件发送失败）
{ "data": { "emailSent": false, "codeExpiresIn": 900, "message": "验证码已发送，请查收邮箱" } }
```

### 登录与注册完成后的认证响应

```json
// 登录请求：account 支持邮箱或用户名二选一
{ "account": "user@example.com 或 zhangsan", "password": "SecurePass123!" }
```

Web 端响应体不暴露 refresh token；服务端通过 `Set-Cookie` 写入 httpOnly Cookie：

```json
{
  "data": {
    "accessToken": "eyJ...",
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "username": "zhangsan",
      "avatar": null,
      "role": "USER",
      "emailVerified": true
    }
  }
}
```

原生移动端在请求头声明 `X-Client-Platform: mobile`，refresh token 随响应体返回且不设置 Web Cookie：

```json
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "<uuid>",
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "username": "zhangsan",
      "avatar": null,
      "role": "USER",
      "emailVerified": true
    }
  }
}
```

注册第二步的响应规则相同，并额外返回 `message: "注册成功"`。`POST /auth/refresh` 沿用 refresh token 记录中的平台，不接受请求头改变终端平台。

### 登出

```json
// 请求（Cookie 优先，body 可选）
{ "refreshToken": "<uuid>" }

// 响应
{ "data": { "message": "已登出" } }
```

### 登录终端列表

```json
// GET /auth/sessions
{
  "data": [
    {
      "id": "6dbd2c1e-...",
      "platform": "web",
      "deviceInfo": "Mozilla/5.0 (...) Chrome/149.0.0.0 Safari/537.36",
      "isCurrent": true,
      "signedInAt": "2026-08-05T09:00:00.000Z",
      "lastActiveAt": "2026-08-05T09:15:00.000Z",
      "expiresAt": "2026-08-12T09:15:00.000Z",
      "createdAt": "2026-08-05T09:00:00.000Z"
    },
    {
      "id": "e70b419f-...",
      "platform": "mobile",
      "deviceInfo": "Dart/3.x (...)",
      "isCurrent": false,
      "signedInAt": "2026-08-02T10:00:00.000Z",
      "lastActiveAt": "2026-08-05T08:30:00.000Z",
      "expiresAt": "2026-09-04T08:30:00.000Z",
      "createdAt": "2026-08-02T10:00:00.000Z"
    }
  ]
}
```

`id` 是 refresh token 轮转期间保持不变的登录终端 ID。`deviceInfo` 是已废弃的原始诊断字段，不稳定也不适合用户阅读；客户端不得直接展示，应仅按 `platform` 映射为“Web 端登录”或“移动端登录”。`createdAt` 是兼容旧客户端的 `signedInAt` 别名。

## 核心业务规则

### 两步注册流程

- 第一步 `request-code`：输入邮箱 → 统一转小写 → 检查是否已注册（409）→ 生成 6 位验证码 → 存入 `EmailVerification` 表（type=REGISTRATION, userId=null）→ 发送邮件
- 第二步 `verify-and-complete`：输入验证码 + 用户名 + 密码 → 查 `EmailVerification`（type=REGISTRATION, email=email）→ 校验验证码 → 创建用户（emailVerified=true）→ 删验证记录 → 创建 RefreshToken → 签发双 Token
- 验证码未过期时**重发同一验证码**（避免首封丢失后重试仍收不到）；验证码已过期时删旧记录，新建并重发
- 所有邮箱在服务端统一转小写后存储和查询
- `request-code` 限流 1/min，P2002 并发时复用已有记录
- `forgotPassword` 仅匹配未注销用户（`deletedAt: null`），已注销走反枚举

### 注册后状态

- 注册完成后 `emailVerified = true`，用户立即可用全部功能
- 注册验证码（type=REGISTRATION）已证明邮箱所有权，无需二次验证
- `verify-email` / `resend-verification` 端点保留，用于 `EMAIL_VERIFY` 类型的验证场景（如手动重新验证邮箱）
- 注册和验证码邮件标题区分：「温油站 — 注册验证码」和「温油站 — 邮箱验证」
- `reset-password` 成功后自动将邮箱标记为已验证（能收重置邮件即证明邮箱所有权）

### 验证码规则

- 统一有效期 15 分钟
- `EmailVerification` 通过 `type` 字段区分用途（REGISTRATION / EMAIL_VERIFY / CHANGE_EMAIL / PASSWORD_RESET），并以用户或邮箱锚定对应流程
- `verifyAndComplete` 和 `verifyEmail` 及 `resetPassword` 均按用户锚定查询（email 或 userId），避免 token 跨用户碰撞
- 验证码由 `crypto.randomInt` 生成固定 6 位数字，不使用 `Math.random`
- 验证码校验错误在锁定记录后原子递增 `attempts`，第 5 次错误即删除记录（需重新获取）；错误/过期状态先提交再返回，不能因抛异常回滚计数
- 验证成功后的业务写入与删除 `EmailVerification` 记录处于同一事务，不能重复消费；重置密码和更换邮箱还会先锁定并重查用户，旧邮箱验证码不能在账号邮箱已变化后继续使用
- 重发验证/重置邮件时，若存在未过期的同类型记录，复用同一验证码重发
- `verify-email` 需登录（AuthRead），从 JWT 获取 userId 进行记录锚定
- `reset-password` 需同时提供邮箱（锚定身份），与 `forgot-password` 流程匹配
- 敏感端点（verify-email/reset-password 5/min，forgot-password/resend-verification/request-code 1/min）有独立限流
- 邮件发送失败通过 `emailSent` 字段和 Logger 反馈（不阻断用户流程）

### 密码规则

- 密码使用 Argon2 哈希，timeCost/memoryCost 参数从环境变量读取
- 密码要求：至少 8 位，必须包含至少一个字母和一个数字
- 修改密码时检查新旧密码不能相同，否则返回 400
- 忘记密码采用统一消息模式，防止邮箱枚举攻击；已注销用户同样走反枚举（不发邮件）
- 修改密码、重置密码和更换邮箱会在凭据事务中吊销全部登录终端，并作废其余密码重置/换邮箱验证码，避免旧凭据或并发验证码继续生效

### Cookie 与平台适配

- Web 端使用 httpOnly Cookie 存储 refreshToken，防 XSS 窃取（`HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`）
- Web 注册、登录和刷新响应体不返回 `refreshToken`；原生移动端不依赖 Cookie，才从响应体获取该字段
- 注册、登录时客户端通过 `X-Client-Platform: web|mobile` 声明平台；未知或缺失值一律归为 `web`。该请求头只是客户端生命周期声明，不是可信的设备指纹或安全凭据
- 刷新时平台取自服务端已有登录终端记录，忽略请求头，避免把 Web 终端升级成 30 天移动端终端
- Web 端 refresh token 有效期 7 天，移动端 30 天，登录和轮转时自动按平台计算
- `/auth/refresh` 优先从 Cookie 读取 token，Cookie 缺失时回退到请求体；`/auth/logout` 优先按 access token 的稳定终端 ID 撤销整个终端，旧 token 才回退到 Cookie/请求体

### 登录终端管理

- `GET /auth/sessions` 最多返回 Web 与移动端各一个活跃登录终端，含 `isCurrent`、`platform`、稳定登录时间、最近轮转时间和过期时间；接口独立限流 60 次/分钟
- `DELETE /auth/sessions/:id` 按稳定终端 ID 退出整个终端；暂时兼容旧客户端传 refresh token 记录 ID
- `POST /auth/logout` 退出当前登录终端并清除 Cookie；无法从 sid 或旧 refresh token 识别有效终端时返回 `SESSION_NOT_FOUND`，不静默成功
- access token 包含稳定终端 ID `sid`。JWT 守卫会在每次受保护请求中检查该终端仍活跃，因此被远程退出或被同端新登录替换后，尚未自然过期的 access token 也会立即失效
- `signedInAt` 在 refresh token 轮转时保持不变；`lastActiveAt` 代表最近一次登录或刷新时间，不代表每次 API 请求活动时间

### 双端登录与 Token 轮转

- 每次显式登录生成唯一 `family`（UUID），它也是对外稳定的登录终端 ID；重启 API 服务不会退出数据库中的有效终端
- 数据库部分唯一索引保证同一用户同一平台最多一条未撤销记录。PC 浏览器和手机浏览器都属于 `web`，后登录者会立即替换先登录者；原生 `mobile` 端可与 Web 端同时在线
- refresh token 原文为随机 UUID，数据库中仅存 SHA-256 哈希
- 调用 `/auth/refresh` 轮转：原子撤销旧 token → 签发同 `family`、同 `platform`、同 `sessionStartedAt` 的新 token
- **并发宽限**：旧 token 撤销后 10 秒内被重复提交时拒绝该请求，但不误伤同 family 的新 token，用于容忍浏览器标签页竞态
- **盗用检测**：宽限期之外重放已撤销 token 时，先提交该 family 全部活跃 token 的吊销，再返回 401
- 已撤销记录保留到自身过期后再清理，确保盗用检测有历史依据
- 改密码、重置密码或注销账号会退出全部登录终端；退出某一终端不影响另一端

历史登录终端迁移、锁风险和当时的发布证据已归档到 [登录终端迁移记录](../history/auth-login-terminal-2026-08-05.md)，不属于当前发布步骤。

### 通用规则

- **登录账号二选一**：`login` 请求体 `account` 接受邮箱或用户名。邮箱分支统一转小写匹配；用户名分支**大小写敏感精确匹配**（与注册唯一约束一致，注册时 "Test" 与 "test" 是两个独立账号）。用户名不允许包含 `@`，故 OR 查询无歧义
- 用户名唯一性在第二步校验（try-catch Prisma P2002 转换为 409）
- 已注销用户（deletedAt 非 null）拒绝登录、刷新和 JWT validate，返回 "该账号已注销"
- 注销时同时吊销全部 refresh token
- 登录事务锁定用户行并重新校验密码、封禁和锁定状态；并发失败会串行累计，第 5 次失败锁定账号 15 分钟，成功后原子重置计数器并替换同平台登录终端
- 已注销的邮箱不可重用注册

## 设计决策

- **Argon2 而非 bcrypt**：Argon2 是 PHC 竞赛获胜者，内存硬函数抗 GPU/ASIC 暴力破解能力更强
- **双 Token 设计**：accessToken 短期（15 分钟）降低泄露风险，refreshToken 长期（7 天）避免频繁登录
- **Refresh Token 储值表 + 轮转**：相比 tokenVersion 方案，可按 Web / 移动端独立退出；SHA-256 哈希存储保护原始 token，稳定 `family` 避免轮转后终端 ID 和登录时间漂移
- **Token 盗用检测**：若已撤销的 refresh token 在 10 秒并发宽限期外被重复使用，吊销整个 family，要求该登录终端重新登录
- **6 位数字验证码**：比 JWT 链接更简单，客户端可直接输入数字码；通过 `type` 字段在 EmailVerification 表中区分注册/验证/重置，防止互串
- **两步注册 + 邮箱验证**：第一步发验证码到邮箱，第二步输入验证码 + 设用户名密码完成注册。验证码已证明邮箱所有权，注册时直接设 `emailVerified: true`，无需二次验证。
- **统一 EmailVerification 表**：废弃 `RegistrationDraft` 表，注册/验证/重置三类验证码共用一张表，code 和 session 概念合一，简化维护
- **VerificationCodeService 统一发码**：注册/验证邮箱/换邮箱/重置密码四条流程共用 `issue()`（查记录 → 未过期复用并重发同一验证码，否则作废旧记录并生成新码；换邮箱以 `resendIfSameEmail` 区分同/异邮箱），消除四处重复的生成/存储/重发逻辑
- **忘记密码反枚举**：无论邮箱是否注册，均返回相同成功消息，防止攻击者探测已注册用户
- **验证码尝试限制**：`attempts` 字段记录失败次数，第 5 次错误自动删除记录，需重新获取；消费临界区使用数据库行锁

## 前端流程指引

| 场景                                         | 行动                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Web 登录：输入邮箱或用户名                   | `POST /auth/login`，请求头声明 `web`；响应体保存 access token 和 user，refresh token 由 httpOnly Cookie 管理 |
| 原生移动端登录                               | `POST /auth/login`，请求头声明 `mobile`；响应体保存 access token、refresh token 和 user                      |
| 登录返回 401 "账号或密码错误"                | 提示用户核对邮箱/用户名和密码，连续 5 次失败锁定 15 分钟                                                     |
| 注册第一步：输入邮箱                         | `POST /auth/register/request-code`，响应含 `emailSent` 标志判断是否发送成功                                  |
| 收到 `emailSent: false`                      | 显示"邮件服务暂不可用，请稍后重试"                                                                           |
| 收到 `emailSent: true`, `message` 含"已发送" | 显示"验证码已发送，请查收邮箱"，引导输入已有验证码                                                           |
| 注册第二步：提交验证码+用户名+密码           | `POST /auth/register/verify-and-complete`，登录后 `emailVerified` 为 true，可直接使用全部功能                |
| 收到注册成功                                 | 已登录，可直接发帖、关注、加入主题帖等                                                                       |
| 输入验证码返回 "验证码错误"                  | 提示用户核对数字，超过 5 次需重新获取                                                                        |
| 输入验证码返回 "验证码已过期，请重新获取"    | 引导重新调用 `request-code` 或 `resend-verification` 获取新码                                                |
| 邮箱验证                                     | `POST /auth/resend-verification` 获取验证码 → `POST /auth/verify-email` 完成验证                             |
| 改密码/重置密码后                            | 全部登录终端被退出，前端清除本地认证状态并引导重新登录                                                       |
| Web 登出                                     | 调用 `POST /auth/logout`；服务端按 sid 撤销终端并清除 Cookie，前端随后清除本地 access token                  |
| 收到 401 "登录终端已失效，请重新登录"        | 当前终端被远程退出或被同端新登录替换，清除本地认证状态并跳转登录页                                           |
| Web refresh 轮转                             | 浏览器自动接收新 httpOnly Cookie；响应体只更新 access token 和 user，不读取 refresh token                    |
| 登录终端列表                                 | 只展示 `platform` 对应的“Web 端登录/移动端登录”，不要展示 `deviceInfo` 原始标识符                            |
