# 数据模型

> 55 张表，31 个 Prisma 枚举。除显式标注的 UUID 外，ID 使用 `cuid()` 生成，时间戳使用 `DateTime`。

## 枚举定义

### ThreadStatus — 主题帖生命周期

| 值 | 说明 |
|----|------|
| `RECRUITING` | 招募中（默认创建时状态） |
| `CLOSED` | 已停招 |
| `FINISHED` | 已结束 |

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

治理相关枚举：`ReportTargetType` 为 `USER / THREAD / POST / MOMENT / MOMENT_COMMENT / DIRECT_MESSAGE`，`ReportStatus` 为 `PENDING / RESOLVED / DISMISSED`，案件状态为 `OPEN / RESOLVED / DISMISSED`，申诉状态为 `PENDING / UPHELD / OVERTURNED`，`UserSanctionType` 为 `SUSPENSION / BAN`。`ContentRemovalSource` 用于区分作者、楼主、帖内管理者和站务隐藏；`AuditAction / AuditTargetType` 固定管理员审计分类。

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
| `tip` | 有人向你或你的主题帖打赏温油 |
| `level_up` | 用户经验达到新等级 |
| `system` | 系统通知（管理员发送，fromUserId 为空） |

### WalletKind / WalletTransactionType — 温油账户与流水

- `WalletKind`：`USER` 为用户钱包，`PLATFORM` 为平台手续费账户；平台账户全局唯一。
- `WalletTransactionType`：`DAILY_CHECK_IN` 为每日领取，`TIP` 为用户或主题帖打赏。
- `TipTargetType`：`THREAD` / `USER`，记录打赏发生的公开目标。
- `ExperienceEventType`：签到、发布主题帖、回复、主题帖获赞以及未来处罚撤销事件。

### SubscriptionType — 订阅粒度

| 值 | 说明 |
|----|------|
| `THREAD` | 订阅官方更新，仅楼主/协作者的新正文、楼层和楼中楼通知 |
| `USER` | 订阅帖内普通已标记玩家，仅该玩家发帖时通知 |

### DirectConversationStatus — 私聊会话状态

| 值 | 说明 |
|----|------|
| `PENDING` | 非互关用户的首条消息请求待接收方处理 |
| `ACCEPTED` | 双方可以继续发送消息 |
| `DECLINED` | 请求被接收方拒绝或因拉黑终止；原发起方不能重试 |
| `CANCELED` | 发起方在十分钟内撤回首条消息并取消请求 |

### StickerImportStatus — 表情导入状态

| 值 | 说明 |
|----|------|
| `PROCESSING` | 已入队，正在下载和规范化 |
| `COMPLETED` | 已生成或复用资产并加入收藏 |
| `FAILED` | 输入或输出不符合规则，或处理重试耗尽 |

### MobilePlatform — 原生推送平台

| 值 | 说明 |
|----|------|
| `android` | Android FCM 终端 |
| `ios` | iOS FCM/APNs 终端 |

---

## 表定义

### users — 用户

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | — |
| email | String | unique, 统一小写存储 | 登录邮箱 |
| username | String | unique | 用户名（唯一，用于登录和展示，字母+数字+中文） |
| password | String | — | Argon2 哈希 |
| avatar | String? | — | 头像 URL；账号注销时置空，后续进入孤儿媒体回收 |
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
| experience | Int | default 0, >= 0 | 精确经验，仅本人资料接口公开 |
| level | Int | default 1, 1..9 | 当前等级，作为用户摘要公开 |
| createdAt | DateTime | default now() | — |
| updatedAt | DateTime | @updatedAt | — |

搜索索引：`users_username_trgm_idx`（GIN + `gin_trgm_ops`），用于用户名子串搜索。

### wallets / wallet_transactions / daily_check_ins — 温油账本

- 每个用户恰有一个 `USER` 钱包；平台有一个 `PLATFORM` 钱包。金额使用 `BIGINT` 整数升，不存在小数、充值或提现。
- `wallet_transactions` 是不可变账本，保存付款、收款和平台费以及各方交易后余额快照。打赏以付款钱包和 UUID `clientRequestId` 唯一，超时重试不会重复扣款。
- 主题帖/用户打赏按用户投入总额计公开统计；收款人实际入账为 `floor(gross * 85 / 100)`，余数进入平台钱包。
- `daily_check_ins` 以用户和北京时间日期唯一，每日随机领取 1～3 升温油并获得 2 经验。

### experience_events / experience_daily_stats — 经验账本

- 正向经验事件按来源幂等写入，日统计按北京时间限制次数；撤销事件保留原因并可使用户降级。
- 等级门槛依次为 0、50、200、600、1500、3500、7000、14000、30000；Lv.9 后继续累计经验。

### user_daily_activities — 每日活跃事实

- 以 `(userId, dateKey)` 为主键，普通用户在一个北京时间自然日最多一行，供管理员看板计算 DAU/WAU/MAU。
- 仅记录首次成功产品请求时间，不记录路径、请求参数、IP 或 User-Agent；管理员请求、通知轮询和失败请求不计入。
- Redis 只做跨实例日内去重，PostgreSQL 唯一键是最终事实与故障回退。

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
> 登录终端迁移的数据量、锁风险和当时的恢复步骤见 [`docs/history/auth-login-terminal-2026-08-05.md`](./history/auth-login-terminal-2026-08-05.md)。该记录不定义当前发布流程。

### mobile_devices — 原生移动推送终端

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | 设备绑定记录 |
| userId | String | FK users (Cascade) | 所属用户 |
| sessionId | String | unique with userId, UUID | 绑定的 mobile refresh-token family |
| pushToken | String | unique | FCM registration token；不得写入日志或 API 响应 |
| platform | MobilePlatform | — | android / ios |
| appVersion | String? | — | 客户端版本，用于兼容诊断 |
| locale | String? | — | 客户端 locale |
| enabled | Boolean | default true | 是否允许继续推送 |
| lastSeenAt | DateTime | — | 最近一次注册或刷新 token 时间 |
| createdAt / updatedAt | DateTime | — | 审计时间 |

每个原生登录终端最多一条绑定，一个 push token 也只能归属一个终端。发送前复查 `sessionId` 对应的 mobile refresh token family 仍活跃；退出登录、失效 token 或长期不活跃清理会将记录停用。

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

### domain_outbox — 可靠领域事件

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | 事件记录 ID |
| eventType | String | — | 进程内领域事件名 |
| aggregateType | String | — | 聚合类型（Post / Thread / UserFollow） |
| aggregateId | String? | — | 聚合 ID |
| eventKey | String | unique | 业务幂等键 |
| payload | Json | — | 监听器所需的事件快照 |
| attempts | Int | default 0 | 已领取次数 |
| availableAt | DateTime | indexed | 租约或下次重试时间 |
| processedAt | DateTime? | indexed | 全部监听器完成时间；null 表示待处理 |
| lastError | String? | — | 最近一次投递错误摘要 |
| createdAt / updatedAt | DateTime | — | 审计时间 |

业务状态和 Outbox 记录在同一个 Prisma 事务提交。分发器使用 `FOR UPDATE SKIP LOCKED` 支持多实例竞争领取，成功记录保留 7 天，未处理记录不自动删除。

### thread_category_definitions — 主题帖分类配置

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | 分类记录 ID |
| slug | String | unique, VarChar(50) | 创建后不可修改的机器标识，Thread 外键引用 |
| name | String | unique, VarChar(50) | 管理员配置的显示名称 |
| description | String? | VarChar(200) | 描述 |
| color | String? | VarChar(7) | `#RRGGBB` 颜色 |
| icon | String? | VarChar(50) | 客户端图标键 |
| sortOrder | Int | default 0 | 展示顺序 |
| isActive | Boolean | default true | 是否允许新选择；停用不删除历史关联 |
| mergedIntoId | String? | self FK (SetNull) | 合并目标分类；未合并为 null，响应契约显式保留 |
| createdAt / updatedAt | DateTime | — | 审计时间 |

旧三类数据由迁移一次性写入注册表并保留原 slug，以维持历史主题帖外键和旧客户端链接；它们不再是运行时代码常量。显示名称、描述、颜色、排序和启停状态均以本表为唯一事实源。公开接口只返回启用项，管理接口返回全部配置。

### threads — 主题帖

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| title | String? | — | 标题（草稿可空，发布时必填） |
| ownerId | String | FK users | 楼主 |
| clientRequestId | UUID? | unique with ownerId | 创建主题帖的客户端幂等键 |
| createRequestHash | String? | — | 规范化创建载荷摘要，用于检测键误用 |
| category | String? | FK thread_category_definitions.slug (Restrict/Cascade) | 动态分类 slug；草稿可空，发布时必须为启用项 |
| status | ThreadStatus | default RECRUITING | 生命周期状态 |
| visibility | ThreadVisibility | default PUBLIC | 可见性 |
| published | Boolean | default false | 是否已发布（发布前为草稿态，不出现在列表/搜索） |
| publishedAt | DateTime? | — | 发布时刻（发布时写入） |
| pinned | Boolean | default false | 是否置顶 |
| pinnedAt | DateTime? | — | 置顶时间 |
| viewCount | Int | default 0 | 浏览量 |
| version | Int | default 1 | 乐观锁版本号 |
| likeCount | Int | default 0 | 点赞数（反范式，与 thread_likes 表同步） |
| defaultSubthreadId | String? | unique, FK subthreads (SetNull) | 默认子贴 ID（必须属于当前主题帖；主题帖创建时自动生成，不可单独删除） |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |
| deletedAt | DateTime? | — | 软删除时间 |

读取索引：`threads_public_created_idx` / `threads_public_active_idx` 支撑公开首页按创建时间或活动时间排序，`threads_owner_created_idx` 支撑用户创建帖列表；`threads_title_trgm_idx`（GIN + `gin_trgm_ops`）用于标题子串搜索。

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

`@@unique([threadId, userId])`；`thread_members_user_played_idx` 支撑用户参与帖倒序读取。

### subthreads — 子贴

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | 所属主题帖 |
| clientRequestId | UUID? | unique with threadId | 创建子贴的客户端幂等键 |
| createRequestHash | String? | — | 规范化创建载荷摘要，用于检测键误用 |
| title | String | — | 子贴标题 |
| sortOrder | Int | default 0, unique per active thread | 排序序号（同一主题帖的未删除子贴中唯一，默认子贴固定为 0；软删除后可复用） |
| postingPolicy | PostingPolicy | default PARTICIPANTS | 发帖权限策略 |
| version | Int | default 1 | 乐观锁 |
| lastPostAt | DateTime? | — | 最后发帖时间 |
| deletedAt | DateTime? | — | 软删除时间 |
| createdAt | DateTime | — | — |

### posts — 帖子（正文/楼层/楼中楼）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| threadId | String | FK threads (Cascade) | 必须与 subthreadId 所属主题帖一致 |
| subthreadId | String | FK subthreads (Cascade) | — |
| authorId | String | FK users | 作者 |
| kind | PostKind | default FLOOR | BODY=子贴正文（floorNumber=null）/ FLOOR=楼层 |
| floorNumber | Int? | unique per subthread | 楼层号（正文与楼中楼为 null） |
| parentPostId | String? | FK posts (Cascade) | 父楼层（楼中楼用，必须位于同一子贴；父楼层硬删除时级联清理回复） |
| replyToPostId | String? | FK posts | 被回复的帖子 ID（必须位于同一子贴） |
| content | String | — | 正文（Markdown，含图片 URL 与内联骰子节点） |
| version | Int | default 1 | 乐观锁 |
| deletedAt | DateTime? | — | 软删除时间 |

楼层首页使用 `posts_floor_page_idx` 按 `subthreadId + kind + deletedAt + floorNumber` 读取；楼中楼分页继续使用 `parentPostId + createdAt` 索引。
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

索引：`@@index([subthreadId, kind])`, `@@index([subthreadId, createdAt])`, `@@index([threadId, createdAt])`, `@@index([parentPostId, createdAt])`（楼中楼分页），以及 `posts_content_trgm_idx`（GIN + `gin_trgm_ops`，正文子串搜索）。三类 trigram 索引由迁移启用 PostgreSQL `pg_trgm` 扩展。

> 子贴正文不单独建表：部分唯一索引保证每个子贴至多一个未删除的 `kind=BODY` 帖子，通过 `PUT /subthreads/:id/body` upsert 维护；楼层接口只返回 `kind=FLOOR`。数据库 CHECK 同时约束 BODY 不得带楼层号/父回复，主楼层必须使用大于 0 的楼层号，楼中楼不得带楼层号；复合外键阻止跨主题、跨子贴引用。

### dice_rolls — 正式骰子结果

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| postId | String | FK posts (Cascade) | 所属帖子 |
| nodeId | UUID | unique per post | 正文内联节点 ID，用于关联显示位置与结果 |
| protocolVersion | Int | default 1 | 骰子协议版本 |
| notation | String | — | 规范化表达式 |
| quantity / sides / modifier | Int | — | 表达式结构化字段 |
| results | Int[] | — | 每枚骰子的服务端原始点数 |
| total | Int | — | 逐骰之和加修正值 |
| createdAt | DateTime | — | 正式结果生成时间 |

`@@unique([postId, nodeId])`。迁移另用 CHECK 约束保护数量、面数、修正值和结果数组长度；已发布编辑按 nodeId 对账，移动保留结果、删除物理清理、同 ID 改表达式拒绝。帖子软删除时查询层隐藏，硬删除时级联清理。

#### 历史迁移重放兼容

早期迁移 `add_subthread_body_post` 没有时间戳前缀：它在既有环境中按创建顺序先于 `20260801160000_post_kind_drop_body_post_id` 应用，但空库重放时会按目录名排到时间戳迁移之后。为保持已应用迁移的名称和 checksum 不变，迁移链使用两段前滚兼容桥：`20260801155959_restore_body_post_id_replay_prerequisite` 在旧模型收缩前临时恢复字段、索引和外键，`zz_20260805100000_cleanup_body_post_id_replay_bridge` 在无时间戳迁移之后幂等清理。既有数据库和空库完整重放最终都不得保留 `subthreads.body_post_id`。

点赞从楼层迁移到主题帖时曾直接执行 `prisma db push`，对应代码提交没有迁移文件。`zzz_20260805110000_reconcile_unmigrated_schema_changes` 为迁移链补齐等价前滚：旧 `post_likes` 按 `(threadId, userId)` 去重迁入 `thread_likes`，据此重算 `threads.like_count`，最后移除旧表和 `posts.like_count`。已通过 db push 对齐的数据库执行该迁移时不会重复写入点赞记录。

兼容桥会先检查 `_prisma_migrations` 和旧表是否存在：已对齐数据库跳过临时字段回填和点赞全表重算。需要修复的旧库中，耗时与 `subthreads/posts` 或 `post_likes/threads` 行数线性相关；`ALTER TABLE` 和最终 `DROP` 会短暂取得表锁，应在发布维护窗口内执行。相关三条迁移均显式使用 PostgreSQL 事务，失败时回滚整条迁移并可在排除锁等待等原因后重试；回填使用唯一索引、`ON CONFLICT DO NOTHING` 和派生计数，可重复执行。

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
| content | String | — | 完整草稿内容（Markdown，内联骰子节点与正文同版本保存） |
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

### bookmark_folders / user_bookmarks — 主题帖收藏夹

`bookmark_folders` 保存用户私有分类：`userId + name` 唯一，`isDefault` 标识不可缺少的默认收藏夹，数据库部分唯一索引保证每个用户最多一个默认夹。`user_bookmarks.folderId` 为必填外键并按收藏夹和创建时间建立索引；`userId + threadId` 仍保持唯一，因此同一主题帖不能重复放入多个收藏夹，只能移动分类。

迁移为所有已有用户创建“默认收藏夹”并回填历史收藏；新用户注册事务同步创建。删除用户级联删除收藏夹和收藏，删除主题帖仍级联删除对应收藏。

### topic_tags — 平台全局标签

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| name | String | unique | 标签名（如"无限流""穿越""西幻"） |
| color | String? | VarChar(7) | `#RRGGBB` 颜色 |
| description | String? | VarChar(200) | 管理员配置的描述 |
| sortOrder | Int | default 0 | 展示顺序 |
| isActive | Boolean | default true | 是否允许搜索和新关联 |
| mergedIntoId | String? | self FK (SetNull) | 合并目标标签；未合并为 null，响应契约显式保留 |
| createdAt / updatedAt | DateTime | — | — |

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

### sticker_assets / sticker_collections / user_stickers / sticker_imports — 表情收藏

| 表 | 核心字段 | 说明 |
|----|----------|------|
| `sticker_assets` | url/key/thumbnailUrl/contentHash/size/width/height/animated/frameCount/durationMs | 规范化后的独立 WebP 资产；内容哈希全局去重 |
| `sticker_collections` | userId(PK), version | 每用户懒创建的私有收藏夹和排序乐观锁版本 |
| `user_stickers` | userId, assetId, position, lastUsedAt | 用户与资产关联；用户+资产唯一，最多 200 条 |
| `sticker_imports` | userId, sourceMediaId?, clientRequestId, status, assetId?, failureCode? | 异步导入和幂等状态；用户+请求 UUID 唯一 |

资产不依赖来源内容生存。`user_stickers` 删除只影响本人；仍被其他收藏、私聊消息或帖子 Markdown 引用的资产不会清理。

### direct_conversations — 一对一私聊会话

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | — |
| firstUserId | String | FK users | 规范化用户对中 ID 较小者 |
| secondUserId | String | FK users | 规范化用户对中 ID 较大者 |
| requesterId | String | FK users | 最近一次请求的发起者 |
| recipientId | String | FK users | 最近一次请求的接收者 |
| status | DirectConversationStatus | default PENDING | 请求/会话状态 |
| lastMessageAt | DateTime? | — | 列表排序时间；无消息的拒绝/取消状态为空 |
| createdAt | DateTime | — | — |
| updatedAt | DateTime | @updatedAt | — |

`@@unique([firstUserId, secondUserId])` 保证每个用户对只有一个会话；数据库 CHECK 保证两列不同。

### direct_conversation_participants — 私聊参与者个人状态

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | — |
| conversationId | String | FK direct_conversations (Cascade) | — |
| userId | String | FK users | 参与者 |
| archivedAt | DateTime? | — | 仅影响该用户自己的列表 |
| createdAt | DateTime | — | — |

`@@unique([conversationId, userId])`，每个会话固定创建两条参与记录。

### direct_messages — 私聊消息

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK, cuid() | — |
| conversationId | String | FK direct_conversations (Cascade) | 所属会话 |
| senderId | String | FK users | 发送者 |
| recipientId | String | FK users | 接收者 |
| mediaId | String? | unique, FK media (SetNull) | 单张图片；同一媒体不能复用 |
| stickerAssetId | String? | FK sticker_assets (SetNull) | 独立收藏表情；发送后不依赖用户继续收藏 |
| clientRequestId | UUID | 与 senderId 联合唯一 | 客户端幂等键 |
| content | String? | 最大 1000 字由 DTO 校验 | 纯文本正文 |
| readAt | DateTime? | — | 仅供接收者未读统计，不对发送者返回 |
| recalledAt | DateTime? | — | 非空时返回撤回占位，不返回正文/图片 |
| createdAt | DateTime | — | — |

数据库 CHECK 要求正常消息至少有正文、图片或表情；撤回占位允许三者为空。历史索引为 `(conversationId, createdAt DESC, id DESC)`，未读索引为 `(recipientId, readAt, createdAt DESC)`。

### reports — 举报

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| reporterId | String? | FK users (SetNull) | 举报人 |
| targetType | ReportTargetType | — | 用户、公开内容或当前用户收到的私聊消息 |
| targetId | String | — | 举报目标 ID |
| reasonCode | ReportReasonCode | default OTHER | 结构化举报原因 |
| details | String? | — | 补充说明；旧自由文本原因迁移到此字段 |
| targetSnapshot | Json? | — | 提交时的版本化脱敏证据快照 |
| status | ReportStatus | default PENDING | 状态（PENDING/RESOLVED/DISMISSED） |
| handledBy | String? | FK users (SetNull) | 处理人 |
| handledAt | DateTime? | — | 处理时间 |
| resolutionNote | String? | — | 结案理由，同时作为关联处罚理由 |
| createdAt / updatedAt | DateTime | — | — |
| caseId | String? | FK moderation_cases | 聚合案件；迁移前历史记录允许为空 |

数据库部分唯一索引保证同一举报人对同一目标最多一条待处理举报；另一个部分唯一索引保证同一目标最多一个开放案件。

### moderation_cases / moderation_decisions / moderation_appeals

- `moderation_cases` 按 `targetType + targetId` 聚合开放举报，记录状态、结案管理员和时间。
- `moderation_decisions` 保存实际动作、政策原因、用户可见说明、内部备注、执行管理员和是否仍生效；推翻只把原决定标为失效，不覆盖历史。
- `moderation_appeals` 以 `decisionId` 唯一约束保证一个决定最多申诉一次，保存申诉人、陈述、复核结果和处理管理员。

### user_sanctions — 账号处罚

记录暂停/封禁、起止时间、创建与解除管理员、理由及关联举报。每个用户最多一条未解除处罚；过期暂停由查询和认证策略按时间判定为无效，记录仍保留用于追溯。

### audit_logs — 管理员操作审计

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | PK | — |
| actorId | String? | FK users (SetNull) | 操作管理员 |
| action | AuditAction | — | 操作类型 |
| targetType | AuditTargetType | — | 操作目标类型 |
| targetId | String? | — | 操作目标 ID |
| reportId | String? | FK reports (SetNull) | 关联举报 |
| reason | String? | — | 管理动作理由 |
| detail | String? | — | 迁移前历史详情，只读保留 |
| metadata | Json? | — | 新操作的结构化脱敏详情 |
| ip | String? | — | 仅兼容迁移前记录；新记录固定为空 |
| requestId | String? | — | 仅兼容迁移前记录；新记录固定为空 |
| createdAt | DateTime | — | — |

新记录的 IP 与 request ID 写入一对一 `audit_sensitive_contexts`，并带一年后 `expiresAt`；永久审计主体只保存治理事实。

### 管理员安全模型

- `admin_auth_challenges`：登录/step-up 邮件验证码哈希、尝试次数、过期和消费时间。
- `admin_sessions`：独立后台会话 token 哈希、空闲活动、绝对过期、近期验证和撤销时间；部分唯一索引限制每用户一个活动会话。
- `admin_invites`：邀请目标、邀请人、token 哈希、状态和过期/接受/取消时间；每用户最多一个待处理邀请。
- `admin_security_events`：登录与近期验证安全事件，携带独立到期时间。

### system_notification_campaigns / site_operational_settings

`system_notification_campaigns` 保存通知正文、目标、JSON 受众、排期、投递状态、预估和实际人数；通知记录通过 `campaignId` 关联并以事件键幂等。`site_operational_settings` 使用固定 `default` 主键保存注册暂停、内容写入暂停和维护公告窗口。
