# 数据模型

> 22 张表，8 个 Prisma 枚举。所有 ID 使用 `cuid()` 生成，时间戳使用 `DateTime`。

## 枚举定义

### ThreadCategory — 主题帖分区

| 值 | 说明 |
|----|------|
| `DEDUCTION` | 推理/解谜 |
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

### MemberRole — 帖内成员角色

| 值 | 说明 |
|----|------|
| `OWNER` | 楼主（唯一），拥有全部管理权限 |
| `COLLABORATOR` | 协作者，可管理子贴 |
| `PARTICIPANT` | 参与者，默认加入角色 |

### PostingPolicy — 子贴发帖权限

| 值 | 说明 | 允许发帖者 |
|----|------|-----------|
| `PARTICIPANTS` | 所有成员 | 全部成员 |
| `COLLABORATORS` | 仅协作者 | OWNER + COLLABORATOR |
| `PLAYERS` | 仅玩家 | 被标记为 playerMarked 的成员 |

### NotificationType — 通知类别

| 值 | 触发事件 |
|----|----------|
| `reply` | 有人楼中楼回复 |
| `mention` | 被 @ 提及 |
| `new_floor` | 有新楼层 |
| `thread_created` | 关注的用户创建了新主题帖 |
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
| email | String | unique | 登录邮箱 |
| username | String | unique | 用户名（唯一，不可重名） |
| password | String | — | Argon2 哈希 |
| nickname | String? | — | 显示昵称 |
| avatar | String? | — | 头像 URL |
| bio | String? | — | 个人简介 |
| role | UserRole | default USER | 权限等级 |
| emailVerified | Boolean | default false | 邮箱是否已验证 |
| showRecentReplies | Boolean | default true | 隐私：允许他人查看最近回复 |
| showPlayerBadges | Boolean | default true | 隐私：允许显示玩家标记 |
| showBookmarks | Boolean | default true | 隐私：允许显示收藏/订阅 |
| deletedAt | DateTime? | — | 软删除（注销时间） |
| createdAt | DateTime | default now() | — |
| updatedAt | DateTime | @updatedAt | — |

### email_verifications — 邮箱验证码

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | — |
| token | String | indexed | 6 位数字验证码 |
| expiresAt | DateTime | — | 过期时间 |
| createdAt | DateTime | — | — |

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
| title | String | — | 标题 |
| category | ThreadCategory | default DEDUCTION | 分区 |
| status | ThreadStatus | default RECRUITING | 生命周期状态 |
| visibility | ThreadVisibility | default PUBLIC | 可见性 |
| pinned | Boolean | default false | 是否置顶 |
| pinnedAt | DateTime? | — | 置顶时间 |
| viewCount | Int | default 0 | 浏览量 |
| version | Int | default 1 | 乐观锁版本号 |
| ownerId | String | FK users | 楼主 |
| deletedAt | DateTime? | — | 软删除时间 |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

### thread_invites — 私密帖邀请链接

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade), unique | 每个帖只有一个邀请链接 |
| token | String | unique | 16 位随机字符串 |
| createdAt | DateTime | — | — |

### thread_members — 主题帖成员

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| userId | String | FK users (Cascade) | — |
| role | MemberRole | default PARTICIPANT | 帖内角色 |
| playerMarked | Boolean | default false | 是否被标记为玩家 |
| joinedAt | DateTime | — | 加入时间 |

`@@unique([threadId, userId])`

### subthreads — 子贴

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | 所属主题帖 |
| title | String | — | 子贴标题 |
| sortOrder | Int | default 0 | 排序序号 |
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
| key | String | — | S3 object key |
| size | Int? | — | 文件大小（bytes） |
| width | Int? | — | 图片宽度（sharp 处理后填入） |
| height | Int? | — | 图片高度 |
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
