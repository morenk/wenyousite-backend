# 用户模块

## 概述

用户资料查询（本人完整信息 / 他人公开信息）、资料更新、账号注销、关注/取消关注、拉黑/取消拉黑、用户搜索。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `User` | 用户实体 |
| `UserFollow` | 关注关系（followerId → followingId，联合唯一） |
| `UserBlock` | 拉黑关系（blockerId → blockedId，联合唯一） |

| 枚举 | 值 |
|------|-----|
| `UserRole` | USER, ADMIN, SUPER_ADMIN |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/users/search?q=` | AuthRead | 搜索用户（@提及用），按用户名模糊匹配 |
| GET | `/users/me` | AuthRead | 获取当前登录用户的完整资料（含邮箱、隐私设置） |
| PATCH | `/users/me` | Auth | 修改当前用户资料（用户名、Bio、隐私设置），5次/分钟限流，需邮箱已验证 |
| PATCH | `/users/me/avatar` | Auth | 设置头像（传入 mediaId，校验归属 + 状态 COMPLETED），需邮箱已验证 |
| DELETE | `/users/me` | Auth | 注销当前账号（软删除，设置 deletedAt），需邮箱已验证 |
| GET | `/users/:id` | Public | 获取指定用户的公开资料（不含邮箱） |
| POST | `/users/follow/:id` | Auth | 关注指定用户 |
| DELETE | `/users/follow/:id` | Auth | 取消关注 |
| GET | `/users/following` | AuthRead | 我的关注列表 |
| GET | `/users/followers` | AuthRead | 我的粉丝列表 |
| POST | `/users/me/block/:id` | Auth | 拉黑指定用户 |
| DELETE | `/users/me/block/:id` | Auth | 取消拉黑 |
| GET | `/users/me/blocks` | AuthRead | 我的黑名单 |

## 核心业务规则

- `findMe` 返回完整字段（email、emailVerified、隐私开关等），仅限本人调用
- `findById` 排除 email 字段，仅返回公开信息
- 已注销用户（deletedAt 非 null）的公开资料被屏蔽为 "已注销用户"，isDeactivated = true
- 更新用户名时检查唯一性（过滤 deletedAt），冲突返回 409；DB 层 P2002 同样转 409 防竞态
- 用户名规则：2-24 位，字母 + 数字 + 中文，禁止标点符号和特殊字符（注册与修改一致）
- 用户名/简介自动去除 HTML 标签（sanitizeContent），防 XSS
- 头像仅可通过 `PATCH /users/me/avatar` 设置（传入 mediaId），不可通过 `PATCH /users/me` 直接修改
- 隐私开关（showRecentReplies / showPlayerBadges / showBookmarks）可通过 `PATCH /users/me` 修改
- 空 body 的 PATCH /users/me 不执行数据库写入，直接返回当前信息
- 资料修改限流 5 次/分钟
- 关注和拉黑端点、资料修改、账号注销均使用 `@Auth()`（需邮箱验证），仅查询操作使用 `@AuthRead()`
- 关注时通过 upsert 实现幂等操作（重复关注不报错）
- 关注自己返回 "不能关注自己" 消息，不执行数据库操作
- 关注成功后异步发送 follow 类型通知给被关注者（fire-and-forget）
- 拉黑同样使用 upsert 保证幂等，拉黑自己返回提示消息
- 用户搜索返回最多 10 条结果，按用户名字母序排列，排除已注销用户

## 设计决策

- **双查询方法（findMe / findById）**：分离本人信息和公开信息，避免敏感字段泄露；findById 为 Public 端点，可供其他模块内部调用
- **已注销用户屏蔽**：保留记录不物理删除（外键关联完整性），但在公开接口中替换为兜底显示名
- **关注/拉黑/资料修改/注销使用 @Auth()**：这些写操作涉及通知推送和信息公开，要求邮箱已验证以减少滥用
- **UserFollow 联合唯一键**：upsert 保证同一关注关系唯一，避免重复关注记录
- **通知推送异步 fire-and-forget**：通知发送失败不影响关注操作的成功返回
