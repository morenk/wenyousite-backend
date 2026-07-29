# 数据模型

> 22 张表，8 个 Prisma 枚举。所有 ID 使用 `cuid()` 生成，时间戳使用 `DateTime`。

## 枚举定义

### ThreadCategory — 主题帖分区

| 值 | 说明 |
|----|------|
| `DEDUCTION` | 演绎 |
| `NATION` | 国策 |
| `RPG` | 角色扮演 |

### ThreadStatus — 主题帖生命周期

| 值 | 说明 |
|----|------|
| `RECRUITING` | 招募中（默认创建时状态） |
| `CLOSED` | 已停招 |
| `FINISHED` | 已完结 |

### ThreadVisibility — 主题帖可见性

| 值 | 说明 |
|----|------|
| `PUBLIC` | 公开，任何人可浏览和搜索 |
| `PRIVATE` | 私密，仅成员可访问，不出现于列表/搜索 |

### UserRole — 用户权限等级

| 值 | 说明 |
|----|------|
| `USER` | 普通用户 |
| `ADMIN` | 管理员 |
| `SUPER_ADMIN` | 超级管理员（站长） |

### MemberRole — 帖内角色

| 值 | 中文 | 定位 |
|----|------|------|
| `OWNER` | 楼主 | 帖子的创建者，拥有全部管理权限，唯一 |
| `COLLABORATOR` | 协作者 | 被楼主指定的共同管理者，可管理子贴和参与人 |
| `PARTICIPANT` | 参与人 | 在帖内发过言的用户，默认角色。本质是楼主的"玩家候选人池"——曾在帖内发言的用户才有资格被标记为玩家 |

### PostingPolicy — 子贴发帖权限

| 值 | 说明 | 允许发帖者 |
|----|------|-----------|
| `PARTICIPANTS` | 所有参与人 | 全体参与人 |
| `COLLABORATORS` | 仅协作者 | OWNER + COLLABORATOR |
| `PLAYERS` | 仅玩家 | 被标记为 playerMarked 的参与人 |

### NotificationType — 通知类别

| 值 | 触发事件 |
|----|----------|
| `reply` | 有人楼中楼回复 |
| `mention` | 被 @ 提及 |
| `new_floor` | 有新楼层 |
| `thread_created` | 关注的用户创建了新主题帖 |
| `subthread_created` | 主题帖内创建了新子贴 |
| `follow` | 有人关注了你 |

### SubscriptionType — 订阅粒度

| 值 | 说明 |
|----|------|
| `THREAD` | 订阅整帖，任何新帖子都通知 |
| `USER` | 订阅帖内某用户，仅该用户发帖时通知 |

---

## 表定义

### users — 用户

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | — |
| email | String | unique, 统一小写存储 | 登录邮箱 |
| username | String | unique | 用户名（唯一，用于登录和展示，字母+数字+中文） |
| password | String | — | Argon2 哈希 |
| avatar | String? | — | 头像 URL |
| bio | String? | — | 个人简介 |
| role | UserRole | default USER | 权限等级 |
| emailVerified | Boolean | default false | 邮箱是否已验证（已验证后才可发帖/关注/加入） |
| showRecentReplies | Boolean | default true | 隐私：允许他人查看最近回复 |
| showPlayerBadges | Boolean | default true | 隐私：允许显示玩家标记 |
| showBookmarks | Boolean | default true | 隐私：允许显示收藏/订阅 |
| deletedAt | DateTime? | — | 软删除（注销时间） |
| failedLoginAttempts | Int | default 0 | 连续登录失败次数（>=5 锁定） |
| lockedUntil | DateTime? | — | 锁定解除时间（15 分钟） |
| lastUsernameChange | DateTime? | — | 上次用户名修改时间（7 天冷却） |
| createdAt | DateTime | default now() | — |
| updatedAt | DateTime | @updatedAt | — |

### email_verifications — 邮箱验证码（统一注册/验证/重置）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String? | FK users (Cascade)，注册阶段为 null | 关联用户 |
| email | String? | — | 注册阶段使用（userId 为空时） |
| token | String | indexed | 6 位数字验证码 |
| type | String | default REGISTRATION | 类型：REGISTRATION / EMAIL_VERIFY / PASSWORD_RESET |
| attempts | Int | default 0 | 失败尝试次数（>=5 删除记录） |
| expiresAt | DateTime | — | 过期时间（统一 15 分钟） |
| createdAt | DateTime | — | — |

> 索引：`@@index([token])`, `@@index([userId, type])`, `@@unique([email, type])`  
> 已废弃 `registration_drafts` 表，统一使用本表承载注册/验证/重置三类用途。  
> `@@unique([email, type])` 防止同一邮箱同时存在多条 REGISTRATION 记录。

### refresh_tokens — 多设备会话

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | — |
| tokenHash | String | indexed | refresh token 的 SHA-256 哈希（不存原文） |
| family | String | — | 设备会话标识（UUID，同设备轮转保持相同） |
| platform | String? | default web | 平台类型：web（7天）或 mobile（30天） |
| deviceInfo | String? | — | User-Agent 摘要 |
| expiresAt | DateTime | — | 过期时间（web 7 天 / mobile 30 天） |
| revokedAt | DateTime? | — | 撤销时间（登出/改密码/盗用检测触发） |
| createdAt | DateTime | — | — |

> 每个登录设备一个 `family`，refresh 轮转时签发新 token 并撤销旧 token。  
> 检测到已撤销 token 被重放时，吊销该 family 下全部 token（防盗用）。  
> 改密码/重置密码时，吊销用户全部 `revokedAt = null` 的记录。  
> Web 端通过 httpOnly Cookie 存储 refreshToken；移动端通过响应体获取。

### user_blocks — 拉黑

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| blockerId | String | FK users (Cascade) | 拉黑者 |
| blockedId | String | FK users (Cascade) | 被拉黑者 |
| createdAt | DateTime | — | — |

`@@unique([blockerId, blockedId])` — 同一对用户不能重复拉黑。

### user_follows — 关注

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| followerId | String | FK users (Cascade) | 关注者 |
| followingId | String | FK users (Cascade) | 被关注者 |
| createdAt | DateTime | — | — |

`@@unique([followerId, followingId])`

### threads — 主题帖

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| title | String? | — | 标题（草稿可空，发布时必填） |
| ownerId | String | FK users | 楼主 |
| category | ThreadCategory | default DEDUCTION | 分区 |
| status | ThreadStatus | default RECRUITING | 生命周期状态 |
| visibility | ThreadVisibility | default PUBLIC | 可见性 |
| published | Boolean | default false | 是否已发布（发布前为草稿态，不出现在列表/搜索） |
| publishedAt | DateTime? | — | 发布时刻（发布时写入） |
| pinned | Boolean | default false | 是否置顶 |
| pinnedAt | DateTime? | — | 置顶时间 |
| viewCount | Int | default 0 | 浏览量 |
| version | Int | default 1 | 乐观锁版本号 |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |
| deletedAt | DateTime? | — | 软删除时间 |

### thread_invites — 私密帖邀请链接

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade), unique | 每个帖只有一个邀请链接 |
| token | String | unique | 16 位随机字符串 |
| createdAt | DateTime | — | — |

### thread_members — 主题帖参与人

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| userId | String | FK users (Cascade) | — |
| role | MemberRole | default PARTICIPANT | 帖内角色 |
| playerMarked | Boolean | default false | 是否为玩家（决定能否在 postingPolicy=PLAYERS 的子贴中发帖） |
| joinedAt | DateTime | — | 加入时间 |

`@@unique([threadId, userId])`

### subthreads — 子贴

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | 所属主题帖 |
| title | String | — | 子贴标题 |
| sortOrder | Int | default 0, unique per thread | 排序序号（帖内唯一，默认子贴固定为 0） |
| postingPolicy | PostingPolicy | default PARTICIPANTS | 发帖权限策略 |
| version | Int | default 1 | 乐观锁 |
| lastPostAt | DateTime? | — | 最后发帖时间 |
| deletedAt | DateTime? | — | 软删除时间 |
| createdAt | DateTime | — | — |

### posts — 帖子（楼层/楼中楼）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| subthreadId | String | FK subthreads (Cascade) | — |
| authorId | String | FK users | 作者 |
| floorNumber | Int? | unique per subthread | 楼层号（楼中楼为 null） |
| parentPostId | String? | FK posts | 父楼层（楼中楼用） |
| replyToPostId | String? | FK posts | 被回复的帖子 ID |
| content | String | — | 正文（Markdown，含图片 URL） |
| version | Int | default 1 | 乐观锁 |
| likeCount | Int | default 0 | 点赞数（反范式） |
| deletedAt | DateTime? | — | 软删除时间 |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

索引：`@@index([subthreadId, createdAt])`, `@@index([threadId, createdAt])`

### post_likes — 点赞记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| postId | String | FK posts (Cascade) | — |
| userId | String | FK users (Cascade) | — |
| createdAt | DateTime | — | — |

`@@unique([postId, userId])`

### post_mentions — @提及记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| postId | String | FK posts (Cascade) | — |
| mentionedUserId | String | FK users (Cascade) | 被 @ 的用户 |
| createdAt | DateTime | — | — |

`@@unique([postId, mentionedUserId])`

### drafts — 草稿

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | — |
| slot | Int | default 1 | 草稿位编号（1-5） |
| content | String | — | 草稿内容（Markdown） |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

`@@unique([userId, slot])` — 每用户最多 5 条草稿，按 slot 区分。

### notifications — 通知

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | 接收者 |
| type | NotificationType | — | 通知类别 |
| content | String? | — | 可读文本（如"xxx 关注了你"） |
| postId | String? | FK posts (SetNull) | 关联帖子 |
| threadId | String? | FK threads (SetNull) | 关联主题帖 |
| fromUserId | String? | FK users (SetNull) | 触发者 |
| isRead | Boolean | default false | 是否已读 |
| createdAt | DateTime | — | — |

索引：`@@index([userId, isRead, createdAt])`

### subscriptions — 订阅

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | 订阅者 |
| threadId | String | FK threads (Cascade) | 目标帖 |
| targetUserId | String? | — | 订阅的用户（USER 类型用） |
| type | SubscriptionType | default THREAD | 订阅粒度 |
| createdAt | DateTime | — | — |

`@@unique([userId, threadId, targetUserId])`, `@@index([userId, type])`

### subthread_tag_defs — 子贴标签定义（帖内自定义标签）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| name | String | unique per thread | 标签名（如"设定区""剧情分歧"） |
| color | String? | — | 颜色值 |
| createdAt | DateTime | — | — |

### subthread_tags — 子贴-标签关联

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| subthreadId | String | FK subthreads (Cascade) | — |
| tagId | String | FK subthread_tag_defs (Cascade) | — |

`@@unique([subthreadId, tagId])`

### topic_tags — 平台全局标签

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| name | String | unique | 标签名（如"无限流""穿越""西幻"） |
| color | String? | — | 颜色值 |
| createdAt | DateTime | — | — |

### thread_topic_tags — 主题帖-标签关联

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| tagId | String | FK topic_tags (Cascade) | — |

`@@unique([threadId, tagId])`

### media — 媒体文件追踪

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | 上传者 |
| url | String | — | 公网访问 URL |
| key | String | unique | S3 object key，唯一约束防重复 |
| size | Int? | — | 文件大小（bytes） |
| width | Int? | — | 图片宽度（sharp 处理后填入） |
| height | Int? | — | 图片高度 |
| status | MediaStatus | default UPLOADING | 处理状态：UPLOADING / PROCESSING / COMPLETED / FAILED |
| createdAt | DateTime | — | — |

### reports — 举报

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| reporterId | String | FK users (SetNull) | 举报人 |
| targetType | String | — | 举报目标类型（POST/THREAD/USER） |
| targetId | String | — | 举报目标 ID |
| reason | String | — | 举报原因 |
| status | String | default PENDING | 状态（PENDING/RESOLVED/DISMISSED） |
| handledBy | String? | FK users (SetNull) | 处理人 |
| handledAt | DateTime? | — | 处理时间 |
| createdAt | DateTime | — | — |

> ⚠️ 举报模块已搁置，待后期重构。

### audit_logs — 管理员操作审计

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| adminId | String | FK users (SetNull) | — |
| action | String | — | 操作类型 |
| targetType | String | — | 操作目标类型 |
| targetId | String? | — | 操作目标 ID |
| detail | String? | — | 操作详情 |
| ip | String? | — | 操作 IP |
| createdAt | DateTime | — | — |

### user_read_progress — 阅读进度

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | — |
| subthreadId | String | FK subthreads (Cascade) | — |
| postId | String? | FK posts (SetNull) | 最后阅读位置 |
| updatedAt | DateTime | @updatedAt | — |

`@@unique([userId, subthreadId])`
