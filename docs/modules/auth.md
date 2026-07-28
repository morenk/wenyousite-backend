# 认证模块

## 概述

用户注册、登录、Token 刷新、邮箱验证、修改密码、忘记/重置密码、登出的全流程实现。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `User` | 用户实体（邮箱、用户名、密码哈希、邮箱验证状态、Token 版本号、注销时间） |
| `EmailVerification` | 邮箱验证/密码重置 Token（6 位数字码 + 类型 + 过期时间） |

| 枚举 | 值 |
|------|-----|
| `UserRole` | USER, ADMIN, SUPER_ADMIN |

## API 端点

| Method | Path | Guard | 限流 | 描述 |
|--------|------|-------|------|------|
| POST | `/auth/register` | Public | 全局 (20/min) | 注册新账号，返回双 Token + 用户信息 |
| POST | `/auth/login` | Public | 全局 (20/min) | 邮箱 + 密码登录，返回双 Token + 用户信息 |
| POST | `/auth/refresh` | Public | 全局 (20/min) | 使用 refreshToken 刷新双 Token |
| POST | `/auth/verify-email` | Public | 5/min | 使用 6 位验证码验证邮箱 |
| POST | `/auth/resend-verification` | Public | 1/min | 重发注册验证邮件 |
| POST | `/auth/change-password` | AuthRead | 全局 (20/min) | 修改密码（需提供旧密码），成功后所有旧 Token 失效 |
| POST | `/auth/forgot-password` | Public | 1/min | 发送密码重置邮件 |
| POST | `/auth/reset-password` | Public | 5/min | 使用验证码重置密码，成功后所有旧 Token 失效 |
| POST | `/auth/logout` | AuthRead | 全局 (20/min) | 登出，使所有已签发 Token 立即失效 |

## 请求/响应格式

### 注册 & 登录 & 刷新（统一响应）

```json
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
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

## 核心业务规则

- 注册时检查邮箱和用户名唯一性，冲突返回 409
- 密码使用 Argon2 哈希，timeCost/memoryCost 参数从环境变量读取
- 注册后自动生成 6 位数字验证码，有效期 24 小时，存入 `EmailVerification` 表（type=EMAIL_VERIFY）
- 注册后立即签发双 Token：accessToken（15 分钟）+ refreshToken（7 天）
- 双 Token 的 JWT payload 内嵌 `tokenVersion`（字段 `tv`），用于 Token 失效控制
- 修改密码时检查新旧密码不能相同，否则返回 400
- 修改密码、重置密码、登出时 `tokenVersion += 1`，使得所有已签发的 Token 立即失效
- JWT 策略在 validate 阶段校验 `payload.tv !== user.tokenVersion`，失效 Token 返回 "令牌已失效，请重新登录"
- 已注销用户（deletedAt 非 null）拒绝登录、刷新和 JWT validate，返回 "该账号已注销"
- 忘记密码与重发验证邮件使用统一消息模式，防止邮箱枚举攻击
- 重置密码时自动将邮箱标记为已验证（emailVerified = true）
- 验证码使用完毕后立即删除 EmailVerification 记录
- EmailVerification 通过 `type` 字段区分用途（EMAIL_VERIFY / PASSWORD_RESET），查询时按类型过滤避免误用
- 重发验证邮件 / 重发重置邮件时，若存在未过期的同类型记录，复用同一验证码重发，用户收到多封邮件码不变
- 验证码校验错误分场景返回：token 不存在 → `'验证码错误'`，已过期 → `'验证码已过期，请重新获取'`
- 敏感端点（verify-email/reset-password 5/min，forgot-password/resend-verification 1/min）有独立限流
- 邮件发送失败通过 Logger.error 记录日志（fire-and-forget 不阻断用户流程）

## 设计决策

- **Argon2 而非 bcrypt**：Argon2 是 PHC 竞赛获胜者，内存硬函数抗 GPU/ASIC 暴力破解能力更强
- **双 Token 设计**：accessToken 短期（15 分钟）降低泄露风险，refreshToken 长期（7 天）避免频繁登录；无状态 JWT 无需服务端 Session 存储
- **Token 版本号（tokenVersion）**：JWT payload 内嵌 `tv` 字段，改密码/登出时 DB 中 `tokenVersion += 1`，策略层校验差异值。相比 Redis Token 黑名单，无需额外存储，单次 DB 写入即可使所有已签发 Token 失效，符合 RFC 7009 Token Revocation 规范
- **6 位数字验证码**：比 JWT 链接更简单，客户端可直接输入数字码；通过 `type` 字段在 EmailVerification 表中区分注册验证和密码重置，防止两类验证码互串
- **注册后立即签发 Token**：允许新用户注册后直接使用系统，邮箱验证为可选后续步骤；VerifiedGuard 仅对关注/拉黑等操作要求验证
- **登录/注册响应包含 emailVerified**：前端可据此展示验证提示，引导用户完成验证或调用重发端点
- **忘记密码反枚举**：无论邮箱是否注册，均返回相同成功消息，防止攻击者探测已注册用户

## 前端流程指引

| 场景 | 行动 |
|------|------|
| 注册成功但未收到邮件 | 调用 `POST /auth/resend-verification` 重发（复用同一验证码） |
| 登录后 `emailVerified: false` | 展示"请验证邮箱"提示，引导到收件箱或重发端点 |
| 输入验证码返回 "验证码错误" | 提示用户核对数字，区分大小写无影响（纯数字） |
| 输入验证码返回 "验证码已过期" | 引导调用重发端点获取新码 |
| 修改密码后 | 所有旧 Token 失效，前端需引导用户重新登录 |
| 登出 | 调用 `POST /auth/logout` 使服务端 Token 失效，同时清除本地存储 |
| 收到 401 "令牌已失效，请重新登录" | Token 版本号不匹配（改密码/登出所致），清除本地 Token 并跳转登录页 |
