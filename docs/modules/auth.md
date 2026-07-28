# 认证模块

## 概述

用户注册（两步：请求验证码 → 验证码+用户名密码完成注册）、登录、Token 刷新、邮箱验证、修改密码、忘记/重置密码、登出的全流程实现。

**多设备会话**：每个登录设备独立管理 refresh token，登出一个设备不影响其他设备。改密码/重置密码时全部设备登出。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `User` | 用户实体（邮箱、用户名、密码哈希、邮箱验证状态、注销时间） |
| `EmailVerification` | 统一的验证码记录（注册/邮箱验证/密码重置三种类型），含尝试次数限制 |
| `RefreshToken` | 多设备会话记录（SHA-256 哈希存 token、family 标识设备、revokedAt 管理生命周期） |

| 枚举 | 值 |
|------|-----|
| `UserRole` | USER, ADMIN, SUPER_ADMIN |
| EmailVerification.type | REGISTRATION, EMAIL_VERIFY, PASSWORD_RESET |

## API 端点

| Method | Path | Guard | 限流 | 描述 |
|--------|------|-------|------|------|
| POST | `/auth/register/request-code` | Public | 1/min | 注册第一步：请求邮箱验证码 |
| POST | `/auth/register/verify-and-complete` | Public | 全局 (20/min) | 注册第二步：验证码 + 用户名密码一步完成注册 |
| POST | `/auth/login` | Public | 全局 (20/min) | 邮箱 + 密码登录，返回双 Token + 用户信息 |
| POST | `/auth/refresh` | Public | 全局 (20/min) | 使用 refreshToken 轮转刷新双 Token（含盗用检测） |
| POST | `/auth/verify-email` | Public | 5/min | 使用 6 位验证码验证邮箱 |
| POST | `/auth/resend-verification` | Public | 1/min | 重发验证邮件 |
| POST | `/auth/change-password` | AuthRead | 全局 (20/min) | 修改密码（需提供旧密码），成功后吊销全部 refresh token |
| POST | `/auth/forgot-password` | Public | 1/min | 发送密码重置邮件 |
| POST | `/auth/reset-password` | Public | 5/min | 使用验证码重置密码，成功后吊销全部 refresh token |
| POST | `/auth/logout` | AuthRead | 全局 (20/min) | 登出，撤销指定设备的 refresh token（Cookie 优先） |
| GET | `/auth/sessions` | AuthRead | 全局 (20/min) | 获取当前用户所有活跃会话列表 |
| DELETE | `/auth/sessions/:id` | AuthRead | 全局 (20/min) | 撤销指定会话（远程登出某设备） |

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

### 注册第二步 / 登录 / 刷新（统一响应）

```json
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "<uuid>",
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "username": "zhangsan",
      "nickname": "张三",
      "avatar": null,
      "role": "USER",
      "emailVerified": false
    }
  }
}
```

### 登出

```json
// 请求（Cookie 优先，body 可选）
{ "refreshToken": "<uuid>" }

// 响应
{ "data": { "message": "已登出" } }
```

### 会话列表

```json
// GET /auth/sessions
{
  "data": [
    {
      "id": "clx...",
      "platform": "web",
      "deviceInfo": "Chrome 132 / Windows",
      "isCurrent": true,
      "createdAt": "2026-07-28T...",
      "expiresAt": "2026-08-04T..."
    },
    {
      "id": "clx...",
      "platform": "mobile",
      "deviceInfo": "iOS App 1.2",
      "isCurrent": false,
      "createdAt": "2026-07-25T...",
      "expiresAt": "2026-08-24T..."
    }
  ]
}
```

## 核心业务规则

### 两步注册流程

- 第一步 `request-code`：输入邮箱 → 统一转小写 → 检查是否已注册（409）→ 生成 6 位验证码 → 存入 `EmailVerification` 表（type=REGISTRATION, userId=null）→ 发送邮件
- 第二步 `verify-and-complete`：输入验证码 + 用户名 + 密码 → 查 `EmailVerification`（type=REGISTRATION, email=email）→ 校验验证码 → 创建用户（emailVerified=false）→ 删验证记录 → 创建 RefreshToken → 签发双 Token
- 验证码未过期时不重发邮件，前端直接提示输入已有验证码
- 验证码已过期时删旧记录，新建并重发
- 所有邮箱在服务端统一转小写后存储和查询
- `request-code` 限流 1/min，防止频繁获取验证码

### 注册后验证

- 注册完成后 `emailVerified = false`，用户处于**只读态**
- 只读态：可浏览帖子/用户资料/搜索，不可发帖/跟帖/关注/加入主题帖/修改资料/上传文件
- 调用 `verify-email`（输入验证码）或通过 `resend-verification` 重发邮件完成验证
- 验证成功后 `emailVerified = true`，解锁全部写权限
- `reset-password` 成功后自动将邮箱标记为已验证（能收重置邮件即证明邮箱所有权）

### 验证码规则

- 统一有效期 15 分钟
- `EmailVerification` 通过 `type` 字段区分用途（REGISTRATION / EMAIL_VERIFY / PASSWORD_RESET）
- 验证码校验错误递增 `attempts`，超过 5 次删除记录（需重新获取）
- 验证码使用完毕后立即删除 `EmailVerification` 记录
- 重发验证/重置邮件时，若存在未过期的同类型记录，复用同一验证码重发
- 敏感端点（verify-email/reset-password 5/min，forgot-password/resend-verification/request-code 1/min）有独立限流
- 邮件发送失败通过 `emailSent` 字段和 Logger 反馈（不阻断用户流程）

### 密码规则

- 密码使用 Argon2 哈希，timeCost/memoryCost 参数从环境变量读取
- 密码要求：至少 8 位，必须包含至少一个字母和一个数字
- 修改密码时检查新旧密码不能相同，否则返回 400
- 忘记密码采用统一消息模式，防止邮箱枚举攻击

### Cookie 与平台适配

- Web 端使用 httpOnly Cookie 存储 refreshToken，防 XSS 窃取（`HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`）
- 同时 JSON 响应体中返回 `refreshToken` 字段，移动端不依赖 Cookie 可直接获取
- 客户端通过 `X-Client-Platform: web|mobile` 请求头声明平台类型
- Web 端 refresh token 有效期 7 天，移动端 30 天，登录和轮转时自动按平台计算
- `/auth/refresh` 和 `/auth/logout` 优先从 Cookie 读取 token，Cookie 缺失时回退到请求体

### 会话管理

- `GET /auth/sessions` 列出当前用户所有活跃会话，含 `isCurrent` 标记、平台类型、设备信息、创建/过期时间
- `DELETE /auth/sessions/:id` 撤销指定会话，用于远程登出某设备（如在 Web 端看到异常移动端登录可远程踢除）
- `POST /auth/logout` 撤销当前设备的 refresh token 并清除 Cookie

### 多设备会话

- 登录时每个设备生成唯一 `family`（UUID），创建 `RefreshToken` 记录
- refresh token 原文为随机 UUID，数据库中仅存 SHA-256 哈希
- 调用 `/auth/refresh` 轮转：撤销旧 token → 签发新 token（同 family、同 platform），返回新的原文字符串
- **盗用检测**：若已撤销的 token 被重放，吊销该 family 下全部 token（整个设备强制登出）
- 登出时传入当前 refresh token，仅撤销该条记录（其他设备不受影响）
- 改密码 / 重置密码：吊销用户全部未撤销的 refresh token（所有设备强制登出）

### 通用规则

- 用户名唯一性在第二步校验（try-catch Prisma P2002 转换为 409）
- 已注销用户（deletedAt 非 null）拒绝登录、刷新和 JWT validate，返回 "该账号已注销"
- accessToken 为无状态 JWT（15 分钟），payload 仅含 `sub`（用户 ID）
- JWT 策略在 validate 阶段仅校验用户存在且未注销，无 tokenVersion

## 设计决策

- **Argon2 而非 bcrypt**：Argon2 是 PHC 竞赛获胜者，内存硬函数抗 GPU/ASIC 暴力破解能力更强
- **双 Token 设计**：accessToken 短期（15 分钟）降低泄露风险，refreshToken 长期（7 天）避免频繁登录
- **Refresh Token 储值表 + 轮转**：相比 tokenVersion 方案，支持多设备独立管理，每个设备可单独登出；SHA-256 哈希存储保护原始 token 不泄露；轮转时撤销旧 token 确保一次性使用
- **Token 盗用检测**：若已撤销的 refresh token 被重复使用，说明 token 可能被盗，吊销整个 family 所有 token，必须重新登录
- **6 位数字验证码**：比 JWT 链接更简单，客户端可直接输入数字码；通过 `type` 字段在 EmailVerification 表中区分注册/验证/重置，防止互串
- **两步注册 + 邮箱验证**：先验证验证码再设密码，注册时仅获得只读权限；验证邮箱后解锁完整功能。杜绝未验证用户发垃圾帖
- **统一 EmailVerification 表**：废弃 `RegistrationDraft` 表，注册/验证/重置三类验证码共用一张表，code 和 session 概念合一，简化维护
- **忘记密码反枚举**：无论邮箱是否注册，均返回相同成功消息，防止攻击者探测已注册用户
- **验证码尝试限制**：`attempts` 字段记录失败次数，超过 5 次自动删除记录，需重新获取

## 前端流程指引

| 场景 | 行动 |
|------|------|
| 注册第一步：输入邮箱 | `POST /auth/register/request-code`，响应含 `emailSent` 标志判断是否发送成功 |
| 收到 `emailSent: false` | 显示"邮件服务暂不可用，请稍后重试" |
| 收到 `emailSent: true`, `message` 含"已发送" | 显示"验证码已发送，请查收邮箱"，引导输入已有验证码 |
| 注册第二步：提交验证码+用户名+密码 | `POST /auth/register/verify-and-complete`，登录后 `emailVerified` 为 false |
| 收到注册成功 | 进入只读态，顶部提示"请验证邮箱以解锁发帖、关注等完整功能" |
| 输入验证码返回 "验证码错误" | 提示用户核对数字，超过 5 次需重新获取 |
| 输入验证码返回 "验证码已过期，请重新获取" | 引导重新调用 `request-code` 或 `resend-verification` 获取新码 |
| 邮箱验证 | `POST /auth/resend-verification` 获取验证码 → `POST /auth/verify-email` 完成验证 |
| 改密码/重置密码后 | 所有设备 refresh token 被吊销，前端需引导用户重新登录 |
| 登出 | 调用 `POST /auth/logout` 传入当前 refreshToken，同时清除本地存储 |
| 收到 401 "令牌已失效，请重新登录" | 可能是 token 盗用检测触发（整个设备被登出），清除本地 Token 并跳转登录页 |
| refresh 轮转 | 每次 `/auth/refresh` 返回新 refreshToken，前端需替换本地存储中的旧值 |
