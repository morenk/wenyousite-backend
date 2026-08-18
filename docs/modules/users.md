# 用户模块

## 概述

用户资料查询（本人完整信息 / 他人公开信息）、资料更新、账号注销、关注/取消关注、拉黑/取消拉黑、用户搜索、收藏公开、最近动态。

## 涉及的模型

| 模型           | 用途                                           |
| -------------- | ---------------------------------------------- |
| `User`         | 用户实体                                       |
| `UserFollow`   | 关注关系（followerId → followingId，联合唯一） |
| `UserBlock`    | 拉黑关系（blockerId → blockedId，联合唯一）    |
| `UserBookmark` | 用户收藏关系（userId → threadId，联合唯一）    |
| `Media`        | 个人主页 3:1 背景图（User 可空一对一引用）     |

| 枚举       | 值                       |
| ---------- | ------------------------ |
| `UserRole` | USER, ADMIN, SUPER_ADMIN |

## API 端点

| Method | Path                          | Guard        | 描述                                                                                                                                                         |
| ------ | ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/users/search?q=`            | AuthRead     | 搜索用户（@提及用），按用户名模糊匹配                                                                                                                        |
| GET    | `/users/me`                   | AuthRead     | 获取当前登录用户的完整资料（含邮箱、隐私设置、社交统计）                                                                                                     |
| PATCH  | `/users/me`                   | Auth         | 修改当前用户资料（用户名、Bio、隐私设置），5次/分钟限流                                                                                                      |
| PATCH  | `/users/me/avatar`            | Auth         | 设置头像（传入 mediaId，校验归属 + 状态 COMPLETED）                                                                                                          |
| DELETE | `/users/me/avatar`            | Auth         | 移除头像（置空 `user.avatar`，回到首字母占位）                                                                                                               |
| PATCH  | `/users/me/profile-cover`     | Auth         | 设置个人主页双画幅背景图（`mediaId` 为 Web 3:1，`mobileMediaId` 为移动端 2:1）                                                                               |
| DELETE | `/users/me/profile-cover`     | Auth         | 同时移除两端个人主页背景图并恢复客户端默认背景                                                                                                               |
| DELETE | `/users/me`                   | Auth         | 注销当前账号（软删除，设置 deletedAt）                                                                                                                       |
| GET    | `/users/:id`                  | OptionalAuth | 获取指定用户的公开资料（不含邮箱）。登录后额外返回 isFollowing / isFollowedBy / isBlocked / isBlockedBy                                                      |
| GET    | `/users/:id/bookmarks`        | OptionalAuth | 查看用户的公开收藏，Cursor 分页。受 showBookmarks 控制                                                                                                       |
| GET    | `/users/:id/played-threads`   | OptionalAuth | 查看用户获得玩家身份的非自建主题帖，支持 `visibility=PUBLIC\|PRIVATE` 分类和 Cursor 分页。本人可见公开帖和私密帖；他人仅见公开帖，并受 showPlayerBadges 控制 |
| GET    | `/users/:id/created-threads`  | OptionalAuth | 查看用户创建的主题帖（本人可见全部含私密帖，他人仅见 PUBLIC 已发布帖），按创建时间倒序，Cursor 分页                                                          |
| GET    | `/users/:id/activity-summary` | OptionalAuth | 用户主页创作汇总：动态、创建主题、玩家身份参与主题、回复总数；遵守拉黑、内容可见性与资料隐私                                                                 |
| GET    | `/users/:id/recent-replies`   | OptionalAuth | 查看用户最近 10 条回复（仅 PUBLIC 帖）。受 showRecentReplies 控制                                                                                            |
| POST   | `/users/follow/:id`           | Auth         | 关注指定用户                                                                                                                                                 |
| DELETE | `/users/follow/:id`           | Auth         | 取消关注                                                                                                                                                     |
| GET    | `/users/following`            | AuthRead     | 我的关注列表                                                                                                                                                 |
| GET    | `/users/followers`            | AuthRead     | 我的粉丝列表                                                                                                                                                 |
| GET    | `/users/:id/following`        | OptionalAuth | 指定用户的关注列表（公开，用户不存在返回 404）                                                                                                               |
| GET    | `/users/:id/followers`        | OptionalAuth | 指定用户的粉丝列表（公开，用户不存在返回 404）                                                                                                               |
| POST   | `/users/me/block/:id`         | Auth         | 拉黑指定用户                                                                                                                                                 |
| DELETE | `/users/me/block/:id`         | Auth         | 取消拉黑                                                                                                                                                     |
| GET    | `/users/me/blocks`            | AuthRead     | 我的黑名单                                                                                                                                                   |

## 资料接口返回字段对照

| 字段                | `GET /users/me` (本人) | `GET /users/:id` (他人) | 说明                                            |
| ------------------- | ---------------------- | ----------------------- | ----------------------------------------------- |
| `id`                | ✓                      | ✓                       | 用户唯一标识                                    |
| `username`          | ✓                      | ✓                       | 用户名                                          |
| `avatar`            | ✓                      | ✓                       | 头像 URL                                        |
| `profileCover`      | ✓                      | ✓                       | 可空背景图（根级 Web 3:1 + 可空 `mobile` 2:1）  |
| `bio`               | ✓                      | ✓                       | 个人简介                                        |
| `role`              | ✓                      | ✓                       | 权限角色                                        |
| `email`             | ✓                      | ✗                       | 仅本人可见                                      |
| `deletedAt`         | ✓                      | ✗                       | 注销时间，仅本人可见                            |
| `createdAt`         | ✓                      | ✓                       | 注册时间                                        |
| `updatedAt`         | ✓                      | ✗                       | 资料最后修改时间，仅本人可见                    |
| `showRecentReplies` | ✓                      | ✓                       | 隐私：是否公开最近动态                          |
| `showPlayerBadges`  | ✓                      | ✓                       | 隐私：是否公开玩家标记                          |
| `showBookmarks`     | ✓                      | ✓                       | 隐私：是否公开收藏                              |
| `accountStatus`     | ✗                      | ✓                       | ACTIVE / SUSPENDED / BANNED；不含截止时间或原因 |
| `_count.following`  | ✓                      | ✓                       | 关注数                                          |
| `_count.followers`  | ✓                      | ✓                       | 粉丝数                                          |
| `isFollowing`       | —                      | ✓ (仅登录)              | 查看者是否关注了目标用户                        |
| `isFollowedBy`      | —                      | ✓ (仅登录)              | 目标用户是否关注了查看者                        |
| `isBlocked`         | —                      | ✓ (仅登录)              | 查看者是否拉黑了目标用户                        |
| `isBlockedBy`       | —                      | ✓ (仅登录)              | 目标用户是否拉黑了查看者                        |
| `isDeactivated`     | ✗                      | ✓ (仅注销)              | 是否已注销，已注销时返回                        |

## OptionalAuth 守卫说明

`@OptionalAuth()` 写入统一认证模式，由全局认证守卫解释：

- 请求携带有效 Bearer Token 时，解析并挂载 `req.user`，后续逻辑以此提供个性数据
- 完全无 Token 时匿名放行，`req.user` 为 `undefined`，返回纯公开数据
- 主动携带过期或无效 Token 时返回稳定 401，防止客户端误把认证故障当成匿名成功
- 适用于需要区分"登录用户"和"未登录用户"返回不同字段的公开端点

## 核心业务规则

- `findMe` 返回完整字段（email、隐私开关等），另附 `_count.following` / `_count.followers`
- `findById` 排除 email / updatedAt / deletedAt 字段，仅返回公开信息。登录后额外返回 4 个关系字段；所有查看者都可见派生的 `accountStatus`
- `accountStatus` 只根据当前有效处罚派生为 `ACTIVE / SUSPENDED / BANNED`，不暴露处罚原因、起止时间或管理员信息；临时处罚缓存不会晚于其结束时间失效
- 已注销用户（deletedAt 非 null）的公开资料被屏蔽为 `{ id, username: '已注销用户', isDeactivated: true }`；帖子作者、楼主、成员、关注关系、收藏、搜索与通知中的用户摘要同样统一输出 `username: '已注销用户', avatar: null`
- 注销时使用不含原用户名/邮箱的内部墓碑值释放两个唯一键，允许原用户或他人日后复用；墓碑值不得进入公开 API
- 注销事务同时将 `users.avatar`、`profileCoverMediaId` 与 `profileCoverMobileMediaId` 置空。已完成媒体还可能被 Markdown 字符串引用，在建立规范化引用账本前不执行即时对象硬删；注销不因对象存储清理失败而回滚，采用“宁可暂留、不可误删”的保守策略
- `GET /users/:id` 返回 `_count.following` 和 `_count.followers`，供前端展示社交数据
- 更新用户名时事务锁定当前用户行并重新读取冷却时间，再检查唯一性和写入；冲突返回 409，DB 层 P2002 同样转 409 防止并发改名竞态
- 用户名修改需间隔 7 天以上，不足时返回剩余天数提示；两个并发请求不能同时绕过同一份旧时间戳
- 用户名规则：2-24 位，字母 + 数字 + 中文，禁止标点符号和特殊字符（注册与修改一致）
- 用户名/简介按 **Markdown 原样存储**（不做 HTML 转义/剥除），XSS 由各端渲染层净化（web 端 react-markdown 默认剥离原始 HTML 标签；移动端需使用 markdown 渲染器或对渲染输出净化）
- 头像仅可通过 `PATCH /users/me/avatar` 设置（传入 mediaId），不可通过 `PATCH /users/me` 直接修改
- 主页背景仅可通过 `PATCH /users/me/profile-cover` 设置：Web `mediaId` 必须接近 3:1，可选 `mobileMediaId` 必须接近 2:1；两者都必须属于本人、状态为 `COMPLETED` 且为 jpg/png/webp。绑定一次写入，旧客户端省略移动 ID 时清空移动裁切；`DELETE` 同时解除两套引用但不删除媒体
- 隐私开关（showRecentReplies / showPlayerBadges / showBookmarks）可通过 `PATCH /users/me` 修改
- 空 body 的 PATCH /users/me 不执行数据库写入，直接返回当前信息
- 资料修改限流 5 次/分钟
- 关注和拉黑端点、资料修改、账号注销均使用 `@Auth()`，仅查询操作使用 `@AuthRead()`
- `GET /users/:id/following` / `GET /users/:id/followers` 为公开查询（`@OptionalAuth()`，无隐私开关），返回全部关注/粉丝（含 id/username/avatar），目标用户不存在返回 404；与「我的关注/粉丝」（`/users/following`、`/users/followers`，仅本人）并存
- 关注通过联合唯一键 + `createMany(skipDuplicates)` 幂等写入，仅在本次创建关系成功时写 Outbox
- 关注自己返回 "不能关注自己" 消息，不执行数据库操作
- 关注成功后由 `UserRelationEventsListener` 双向过滤拉黑并发送 follow 通知；队列失败由 Outbox 退避重试
- 拉黑使用 upsert 保证幂等，拉黑自己返回提示消息
- 用户搜索返回最多 10 条结果，按用户名字母序排列，排除已注销用户
- 公开收藏 (`GET /users/:id/bookmarks`)：受 `showBookmarks` 控制，关闭时返回 404；未发布帖不显示；私密帖仅对其参与人可见；本人始终可见；Cursor 分页。响应复用首页完整主题帖卡片，但不暴露收藏记录或收藏夹 ID
- 参与帖子 (`GET /users/:id/played-threads`)：只有被帖子管理者授予玩家身份（`playerMarked=true`）才算参与，仅回复过而生成的候选成员关系不计入。列表始终排除自己创建的帖（`ownerId = targetId`），按加入时间倒序并使用 Cursor 分页。本人可用 `visibility=PUBLIC|PRIVATE` 分类查看已获玩家身份的公开帖或私密帖；他人查看时只返回 PUBLIC 帖，并受 `showPlayerBadges` 控制。非本人请求 PRIVATE 分类固定返回空列表。响应复用首页完整主题帖卡片
- 创建帖子 (`GET /users/:id/created-threads`)：无隐私开关，由帖本身 visibility 控制——本人可见全部已发布帖（含 PRIVATE），他人仅见 PUBLIC 帖；按创建时间倒序排列；Cursor 分页。响应复用首页完整主题帖卡片
- 活动汇总 (`GET /users/:id/activity-summary`)：动态数过滤删除内容与当前查看者的双向拉黑关系；创建/参与主题数与对应列表采用相同的已发布、未删除、PUBLIC/PRIVATE 范围；参与数排除自建帖。`showPlayerBadges` 或 `showRecentReplies` 对他人关闭时，对应计数返回 `null` 且不执行受保护统计；本人始终可见。
- 最近动态 (`GET /users/:id/recent-replies`)：受 `showRecentReplies` 控制，关闭时返回 404；他人只看到 PUBLIC 帖，本人可看到自己在已发布 PUBLIC/PRIVATE 帖中的记录。仅返回 `kind=FLOOR` 的楼层/楼中楼回复，排除默认正文 `BODY`；固定返回最近 10 条不分页。每条含 `preview`（Markdown 剥离后的纯文本截断，使用 `truncateMarkdown`）和 `parentPostId`（为 null 则为楼层回复，非 null 则为楼中楼）

## 隐私开关行为详解

| 开关                | 默认值 | 关闭时的行为                                                                                                              |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `showBookmarks`     | `true` | 他人无法通过 `GET /users/:id/bookmarks` 查看你的收藏（返回 404）。本人始终可查看                                          |
| `showRecentReplies` | `true` | 他人无法通过 `GET /users/:id/recent-replies` 查看你的最近 10 条回复（返回 404）。本人始终可查看                           |
| `showPlayerBadges`  | `true` | 他人无法通过 `GET /users/:id/played-threads` 查看你参与的帖子（返回 404）。本人始终可查看。前端另据此决定是否展示玩家标识 |

## 设计决策

- **双查询方法（findMe / findById）**：分离本人信息和公开信息，避免敏感字段泄露。`findById` 接受可选 `viewerId` 供 optional auth 场景
- **OptionalAuth 守卫**：不同于 `@Public()` 完全跳过 JWT 解析，`@OptionalAuth()` 会尝试解析 token 但不强制，使公开接口能在登录态下返回个性化数据
- **参与/创建分离**：自建帖归入创建列表，参与列表只含其他楼主的帖子，且统一以 `playerMarked=true` 表示已获授玩家身份；本人可见其中的私密帖，他人只能看到公开玩家关系
- **已注销用户屏蔽**：保留记录不物理删除（外键关联完整性），所有面向客户端的用户摘要查询携带 `deletedAt` 供统一响应层转换，仅输出兜底显示名和空头像，不暴露内部墓碑值或注销时间（通知为兼容既有跳转判断保留 `fromUser.deletedAt`）
- **关注/拉黑/资料修改/注销使用 @Auth()**：这些写操作涉及通知推送和信息公开，要求邮箱已验证以减少滥用
- **UserFollow 联合唯一键**：`createMany(skipDuplicates)` 保证同一关注关系唯一，避免并发重复记录
- **通知推送可靠异步**：关注关系和 `user.followed` Outbox 在同一事务提交；HTTP 不等待通知落库，但已提交事件不会因进程退出或队列短暂故障丢失
- **隐私开关前后端协作**：开关值由后端存储并返回，前端根据值隐藏/显示对应板块。`showBookmarks` 和 `showRecentReplies` 由后端在 API 层强制执行（404），而非仅依赖前端
