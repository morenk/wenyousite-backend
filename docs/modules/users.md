# 用户模块

## 概述

用户资料查询（本人完整信息 / 他人公开信息）、资料更新、账号注销、关注/取消关注、拉黑/取消拉黑、用户搜索、收藏公开、最近动态。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `User` | 用户实体 |
| `UserFollow` | 关注关系（followerId → followingId，联合唯一） |
| `UserBlock` | 拉黑关系（blockerId → blockedId，联合唯一） |
| `UserBookmark` | 用户收藏关系（userId → threadId，联合唯一） |

| 枚举 | 值 |
|------|-----|
| `UserRole` | USER, ADMIN, SUPER_ADMIN |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/users/search?q=` | AuthRead | 搜索用户（@提及用），按用户名模糊匹配 |
| GET | `/users/me` | AuthRead | 获取当前登录用户的完整资料（含邮箱、隐私设置、社交统计） |
| PATCH | `/users/me` | Auth | 修改当前用户资料（用户名、Bio、隐私设置），5次/分钟限流，需邮箱已验证 |
| PATCH | `/users/me/avatar` | Auth | 设置头像（传入 mediaId，校验归属 + 状态 COMPLETED），需邮箱已验证 |
| DELETE | `/users/me` | Auth | 注销当前账号（软删除，设置 deletedAt），需邮箱已验证 |
| GET | `/users/:id` | OptionalAuth | 获取指定用户的公开资料（不含邮箱）。登录后额外返回 isFollowing / isFollowedBy / isBlocked / isBlockedBy |
| GET | `/users/:id/bookmarks` | OptionalAuth | 查看用户的公开收藏，Cursor 分页。受 showBookmarks 控制 |
| GET | `/users/:id/played-threads` | OptionalAuth | 查看用户参与的主题帖（被标记为玩家的帖），按加入时间倒序，Cursor 分页。受 showPlayerBadges 控制 |
| GET | `/users/:id/recent-replies` | OptionalAuth | 查看用户最近 10 条回复（仅 PUBLIC 帖）。受 showRecentReplies 控制 |
| POST | `/users/follow/:id` | Auth | 关注指定用户 |
| DELETE | `/users/follow/:id` | Auth | 取消关注 |
| GET | `/users/following` | AuthRead | 我的关注列表 |
| GET | `/users/followers` | AuthRead | 我的粉丝列表 |
| POST | `/users/me/block/:id` | Auth | 拉黑指定用户 |
| DELETE | `/users/me/block/:id` | Auth | 取消拉黑 |
| GET | `/users/me/blocks` | AuthRead | 我的黑名单 |

## 资料接口返回字段对照

| 字段 | `GET /users/me` (本人) | `GET /users/:id` (他人) | 说明 |
|------|------------------------|-------------------------|------|
| `id` | ✓ | ✓ | 用户唯一标识 |
| `username` | ✓ | ✓ | 用户名 |
| `avatar` | ✓ | ✓ | 头像 URL |
| `bio` | ✓ | ✓ | 个人简介 |
| `role` | ✓ | ✓ | 权限角色 |
| `email` | ✓ | ✗ | 仅本人可见 |
| `emailVerified` | ✓ | ✗ | 邮箱验证状态，仅本人可见 |
| `deletedAt` | ✓ | ✗ | 注销时间，仅本人可见 |
| `createdAt` | ✓ | ✓ | 注册时间 |
| `updatedAt` | ✓ | ✗ | 资料最后修改时间，仅本人可见 |
| `showRecentReplies` | ✓ | ✓ | 隐私：是否公开最近动态 |
| `showPlayerBadges` | ✓ | ✓ | 隐私：是否公开玩家标记 |
| `showBookmarks` | ✓ | ✓ | 隐私：是否公开收藏 |
| `_count.following` | ✓ | ✓ | 关注数 |
| `_count.followers` | ✓ | ✓ | 粉丝数 |
| `isFollowing` | — | ✓ (仅登录) | 查看者是否关注了目标用户 |
| `isFollowedBy` | — | ✓ (仅登录) | 目标用户是否关注了查看者 |
| `isBlocked` | — | ✓ (仅登录) | 查看者是否拉黑了目标用户 |
| `isBlockedBy` | — | ✓ (仅登录) | 目标用户是否拉黑了查看者 |
| `isDeactivated` | ✗ | ✓ (仅注销) | 是否已注销，已注销时返回 |

## OptionalAuth 守卫说明

`@OptionalAuth()` 装饰器应用 `OptionalJwtAuthGuard`：
- 请求携带有效 Bearer Token 时，解析并挂载 `req.user`，后续逻辑以此提供个性数据
- 无 Token 或 Token 过期/无效时，不抛异常，`req.user` 为 `undefined`，返回纯公开数据
- 适用于需要区分"登录用户"和"未登录用户"返回不同字段的公开端点

## 核心业务规则

- `findMe` 返回完整字段（email、emailVerified、隐私开关等），另附 `_count.following` / `_count.followers`
- `findById` 排除 email / emailVerified / updatedAt / deletedAt 字段，仅返回公开信息。登录后额外返回 4 个关系字段
- 已注销用户（deletedAt 非 null）的公开资料被屏蔽为 `{ id, username: '已注销用户', isDeactivated: true }`
- 注销时释放 username 和 email 唯一性（追加 `_deleted_{timestamp}` 后缀），允许原用户或他人日后复用
- `GET /users/:id` 返回 `_count.following` 和 `_count.followers`，供前端展示社交数据
- 更新用户名时检查唯一性（过滤 deletedAt），冲突返回 409；DB 层 P2002 同样转 409 防竞态
- 用户名修改需间隔 7 天以上，不足时返回剩余天数提示
- 用户名规则：2-24 位，字母 + 数字 + 中文，禁止标点符号和特殊字符（注册与修改一致）
- 用户名/简介自动去除 HTML 标签（sanitizeContent），防 XSS
- 头像仅可通过 `PATCH /users/me/avatar` 设置（传入 mediaId），不可通过 `PATCH /users/me` 直接修改
- 隐私开关（showRecentReplies / showPlayerBadges / showBookmarks）可通过 `PATCH /users/me` 修改
- 空 body 的 PATCH /users/me 不执行数据库写入，直接返回当前信息
- 资料修改限流 5 次/分钟
- 关注和拉黑端点、资料修改、账号注销均使用 `@Auth()`（需邮箱验证），仅查询操作使用 `@AuthRead()`
- 关注时检查是否已关注，仅在首次关注时发送通知，避免重复通知
- 关注自己返回 "不能关注自己" 消息，不执行数据库操作
- 关注成功后异步发送 follow 类型通知给被关注者（fire-and-forget）
- 拉黑使用 upsert 保证幂等，拉黑自己返回提示消息
- 用户搜索返回最多 10 条结果，按用户名字母序排列，排除已注销用户
- 公开收藏 (`GET /users/:id/bookmarks`)：受 `showBookmarks` 控制，关闭时返回 404；未发布帖不显示；私密帖仅对其参与人可见；本人始终可见；Cursor 分页
- 参与帖子 (`GET /users/:id/played-threads`)：受 `showPlayerBadges` 控制，关闭时返回 404；按加入时间倒序排列；本人始终可见全部帖子；他人仅能看到 PUBLIC 帖；Cursor 分页
- 最近动态 (`GET /users/:id/recent-replies`)：受 `showRecentReplies` 控制，关闭时返回 404；仅返回 PUBLIC 帖中的回复；本人始终可见自己的动态；固定返回最近 10 条不分页。每条含 `preview`（Markdown 剥离后的纯文本截断，使用 `truncateMarkdown`）和 `parentPostId`（为 null 则为楼层回复，非 null 则为楼中楼）

## 隐私开关行为详解

| 开关 | 默认值 | 关闭时的行为 |
|------|--------|-------------|
| `showBookmarks` | `true` | 他人无法通过 `GET /users/:id/bookmarks` 查看你的收藏（返回 404）。本人始终可查看 |
| `showRecentReplies` | `true` | 他人无法通过 `GET /users/:id/recent-replies` 查看你的最近 10 条回复（返回 404）。本人始终可查看 |
| `showPlayerBadges` | `true` | 他人无法通过 `GET /users/:id/played-threads` 查看你参与的帖子（返回 404）。本人始终可查看。前端另据此决定是否展示玩家标识 |

## 设计决策

- **双查询方法（findMe / findById）**：分离本人信息和公开信息，避免敏感字段泄露。`findById` 接受可选 `viewerId` 供 optional auth 场景
- **OptionalAuth 守卫**：不同于 `@Public()` 完全跳过 JWT 解析，`@OptionalAuth()` 会尝试解析 token 但不强制，使公开接口能在登录态下返回个性化数据
- **已注销用户屏蔽**：保留记录不物理删除（外键关联完整性），但在公开接口中替换为兜底显示名，不暴露注销时间
- **关注/拉黑/资料修改/注销使用 @Auth()**：这些写操作涉及通知推送和信息公开，要求邮箱已验证以减少滥用
- **UserFollow 联合唯一键**：upsert 保证同一关注关系唯一，避免重复关注记录
- **通知推送异步 fire-and-forget**：通知发送失败不影响关注操作的成功返回
- **隐私开关前后端协作**：开关值由后端存储并返回，前端根据值隐藏/显示对应板块。`showBookmarks` 和 `showRecentReplies` 由后端在 API 层强制执行（404），而非仅依赖前端
