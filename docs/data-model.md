# 数据模型

> 22 张表，9 个 Prisma 枚举。所有 ID 使用 `cuid()` 生成，时间戳使用 `DateTime`。

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
| `COLLABORATOR` | 协作者 | 可编辑帖子元数据、子贴、正文和玩家标记，可删他人内容；不可改可见性/发布、邀请、任免协作者或删整帖 |
| `PARTICIPANT` | 参与人 | 在帖内发过言的用户，默认角色。本质是楼主的"玩家候选人池"——曾在帖内发言的用户才有资格被标记为玩家 |

### PostingPolicy — 子贴发帖权限

| 值 | 说明 | 允许发帖者 |
|----|------|-----------|
| `PARTICIPANTS` | 所有可访问用户 | 已通过主题帖访问校验的登录用户；首次发言自动成为 PARTICIPANT |
| `COLLABORATORS` | 仅协作者 | OWNER + COLLABORATOR |
| `PLAYERS` | 仅玩家 | 被标记为 playerMarked 的参与人；OWNER/COLLABORATOR 绕过限制 |

### PostKind — 帖子角色

| 值 | 说明 |
|----|------|
| `BODY` | 子贴正文（每子贴至多一个，`floorNumber = null`，不占楼层号；不可删除，由子贴生命周期管理） |
| `FLOOR` | 楼层（`floorNumber` 从 1 开始编号） |

### NotificationType — 通知类别

| 值 | 触发事件 |
|----|----------|
| `reply` | 有人楼中楼回复 |
| `mention` | 被 @ 提及 |
| `new_post` | 帖内有新内容（子贴正文或新楼层） |
| `thread_created` | 关注的用户创建了新主题帖 |
| `follow` | 有人关注了你 |
| `like` | 有人赞了你的帖子 |
| `system` | 系统通知（管理员发送，fromUserId 为空） |

### SubscriptionType — 订阅粒度

| 值 | 说明 |
|----|------|
| `THREAD` | 订阅官方更新，仅楼主/协作者的新正文、楼层和楼中楼通知 |
| `USER` | 订阅帖内普通已标记玩家，仅该玩家发帖时通知 |

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

搜索索引：`users_username_trgm_idx`（GIN + `gin_trgm_ops`），用于用户名子串搜索。

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

### refresh_tokens — 双端登录终端

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | — |
| tokenHash | String | indexed | refresh token 的 SHA-256 哈希（不存原文） |
| family | String | — | 稳定登录终端 ID（UUID，同终端轮转保持相同） |
| platform | String | NOT NULL, default web | 平台类型：web（PC/手机浏览器，7天）或 mobile（原生移动端，30天） |
| deviceInfo | String? | — | 原始 User-Agent 诊断信息（API 已废弃，前端不得直接展示） |
| sessionStartedAt | DateTime | default now() | 该登录终端的首次登录时间，轮转时保持不变 |
| expiresAt | DateTime | — | 过期时间（web 7 天 / mobile 30 天） |
| revokedAt | DateTime? | — | 撤销时间（登出/改密码/盗用检测触发） |
| createdAt | DateTime | — | 当前 refresh token 记录创建时间，可作为最近登录/刷新时间 |

> `platform` 由数据库检查约束限制为 `web | mobile`；每个用户每个平台最多一条 `revoked_at IS NULL` 记录（数据库部分唯一索引）。PC/手机浏览器共用 `web` 槽位，原生客户端使用 `mobile` 槽位。同端新登录会退出旧终端，Web 与移动端可同时在线。
>
> 每个登录终端一个 `family`。refresh 轮转时先撤销旧记录，再以同一 `family`、`platform`、`sessionStartedAt` 签发新记录；API 对外使用 `family` 作为稳定 ID。
>
> access token 携带 `sid=family`，受保护请求会查询该终端是否仍活跃，使远程退出立即生效。10 秒内的旧 token 并发重放只拒绝请求；超过宽限期则吊销该 family。
>
> 已撤销记录保留到 `expiresAt` 后再由清理任务删除，以保留盗用检测依据。改密码/重置密码时吊销用户全部 `revokedAt = null` 记录。
>
> Web 端通过 httpOnly Cookie 存储 refreshToken；移动端通过响应体获取。
>
> 发布批次 `auth-login-terminal-2026-08-05` 的迁移数据量、锁风险、部署顺序和失败恢复步骤见 `docs/modules/auth.md` 的“数据迁移与兼容”。

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
| likeCount | Int | default 0 | 点赞数（反范式，与 thread_likes 表同步） |
| defaultSubthreadId | String? | unique, FK subthreads (SetNull) | 默认子贴 ID（主题帖创建时自动生成，不可单独删除） |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |
| deletedAt | DateTime? | — | 软删除时间 |

搜索索引：`threads_title_trgm_idx`（GIN + `gin_trgm_ops`），用于主题帖标题子串搜索。

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

### posts — 帖子（正文/楼层/楼中楼）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| subthreadId | String | FK subthreads (Cascade) | — |
| authorId | String | FK users | 作者 |
| kind | PostKind | default FLOOR | BODY=子贴正文（floorNumber=null）/ FLOOR=楼层 |
| floorNumber | Int? | unique per subthread | 楼层号（正文与楼中楼为 null） |
| parentPostId | String? | FK posts | 父楼层（楼中楼用） |
| replyToPostId | String? | FK posts | 被回复的帖子 ID |
| content | String | — | 正文（Markdown，含图片 URL） |
| pendingDiceNotations | String[] | default [] | 未发布主题帖中的待掷表达式；发布事务结算后清空 |
| version | Int | default 1 | 乐观锁 |
| deletedAt | DateTime? | — | 软删除时间 |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

索引：`@@index([subthreadId, kind])`, `@@index([subthreadId, createdAt])`, `@@index([threadId, createdAt])`, `@@index([parentPostId, createdAt])`（楼中楼分页），以及 `posts_content_trgm_idx`（GIN + `gin_trgm_ops`，正文子串搜索）。三类 trigram 索引由迁移启用 PostgreSQL `pg_trgm` 扩展。

> 子贴正文不单独建表：每子贴至多一个 `kind=BODY` 的帖子，通过 `PUT /subthreads/:id/body` upsert 维护；楼层接口只返回 `kind=FLOOR`。

### dice_rolls — 正式骰子结果

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| postId | String | FK posts (Cascade) | 所属帖子 |
| sequence | Int | unique per post | 帖子内稳定序号，从 1 开始 |
| protocolVersion | Int | default 1 | 骰子协议版本 |
| notation | String | — | 规范化表达式 |
| quantity / sides / modifier | Int | — | 表达式结构化字段 |
| results | Int[] | — | 每枚骰子的服务端原始点数 |
| total | Int | — | 逐骰之和加修正值 |
| createdAt | DateTime | — | 正式结果生成时间 |

`@@unique([postId, sequence])`。迁移另用 CHECK 约束保护序号、数量、面数、修正值和结果数组长度；结果创建后不提供更新或重掷路径，帖子软删除时查询层隐藏，硬删除时级联清理。

#### 历史迁移重放兼容

早期迁移 `add_subthread_body_post` 没有时间戳前缀：它在既有环境中按创建顺序先于 `20260801160000_post_kind_drop_body_post_id` 应用，但空库重放时会按目录名排到时间戳迁移之后。为保持已应用迁移的名称和 checksum 不变，迁移链使用两段前滚兼容桥：`20260801155959_restore_body_post_id_replay_prerequisite` 在旧模型收缩前临时恢复字段、索引和外键，`zz_20260805100000_cleanup_body_post_id_replay_bridge` 在无时间戳迁移之后幂等清理。既有数据库和空库完整重放最终都不得保留 `subthreads.body_post_id`。

点赞从楼层迁移到主题帖时曾直接执行 `prisma db push`，对应代码提交没有迁移文件。`zzz_20260805110000_reconcile_unmigrated_schema_changes` 为迁移链补齐等价前滚：旧 `post_likes` 按 `(threadId, userId)` 去重迁入 `thread_likes`，据此重算 `threads.like_count`，最后移除旧表和 `posts.like_count`。已通过 db push 对齐的数据库执行该迁移时不会重复写入点赞记录。

兼容桥会先检查 `_prisma_migrations` 和旧表是否存在：已对齐数据库跳过临时字段回填和点赞全表重算。需要修复的旧库中，耗时与 `subthreads/posts` 或 `post_likes/threads` 行数线性相关；`ALTER TABLE` 和最终 `DROP` 会短暂取得表锁，应在发布维护窗口内执行。本轮三条迁移均显式使用 PostgreSQL 事务，失败时回滚整条迁移并可在排除锁等待等原因后重试；回填使用唯一索引、`ON CONFLICT DO NOTHING` 和派生计数，可重复执行。

### thread_likes — 点赞记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | — |
| userId | String | FK users (Cascade) | — |
| createdAt | DateTime | — | — |

`@@unique([threadId, userId])`

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
| pendingDiceNotations | String[] | default [] | 与 content 同版本保存的待掷骰子表达式 |
| version | Int | default 1 | 跨设备乐观锁版本 |
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
| fromUserId | String? | FK users (SetNull) | 触发者（系统通知为空） |
| isRead | Boolean | default false | 是否已读 |
| createdAt | DateTime | — | — |

索引：`@@index([userId, isRead, createdAt])`

### subscriptions — 订阅

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| userId | String | FK users (Cascade) | 订阅者 |
| threadId | String | FK threads (Cascade) | 目标帖 |
| targetUserId | String? | FK users (Cascade) | 订阅的普通玩家（USER 类型用） |
| type | SubscriptionType | default THREAD | 订阅粒度 |
| createdAt | DateTime | — | — |

唯一索引为 `(userId, threadId, targetUserId) NULLS NOT DISTINCT`，保证 THREAD 的空目标也唯一；CHECK 约束要求 THREAD 目标为空、USER 目标非空。`@@index([userId, type])` 支撑列表查询。

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
| contentType | String? | — | 上传凭证签发时声明的 MIME；确认时更新为对象存储返回的规范化 MIME |
| size | Int? | — | 上传凭证签发时声明的大小；确认和处理时更新为实际文件大小（bytes） |
| width | Int? | — | 图片宽度（sharp 处理后填入） |
| height | Int? | — | 图片高度 |
| status | MediaStatus | default UPLOADING | 处理状态：UPLOADING / PROCESSING / COMPLETED / FAILED |
| createdAt | DateTime | — | — |

`@@index([status, createdAt])` — 支撑孤儿图片回收的候选查询。

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
