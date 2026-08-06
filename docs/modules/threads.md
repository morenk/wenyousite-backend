# 主题帖模块

> 本轮跨端发布批次：`private-thread-access-2026-08-05`。

## 概述

主题帖的草稿创建、沙盒迭代、发布、列表、详情、修改、删除，参与人候选池管理（授予/移除协作者身份、授予/收回玩家身份），私密帖邀请链接，置顶排序，标签管理。

**核心流程**：所有主题帖创建统一走"草稿 → 发布"两阶段 —— `POST /threads` 事务内创建 Thread + OWNER + 默认子贴（可选正文，kind=BODY），在沙盒内逐步完善标题/子贴/楼层，最后通过 `PATCH /threads/:id { published: true }` 发布。发布前帖子不出现在列表/搜索中，仅楼主本人可访问。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Thread` | 主题帖实体（含 published 字段控制发布状态） |
| `ThreadMember` | 帖内参与人关系（userId + role + playerMarked） |
| `ThreadInvite` | 私密帖邀请链接（token + threadId，一对一 upsert） |
| `ThreadTopicTag` | 主题帖与平台 TopicTag 的多对多关联 |
| `SubthreadTagDef` | 子贴标签定义（归属主题帖，用于标签管理） |

| 枚举 | 值 |
|------|-----|
| `ThreadCategory` | DEDUCTION, NATION, RPG |
| `ThreadStatus` | RECRUITING, CLOSED, FINISHED |
| `ThreadVisibility` | PUBLIC, PRIVATE |
| `MemberRole` | OWNER, COLLABORATOR, PARTICIPANT |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/threads/draft` | AuthRead | 我的草稿箱列表（published=false 的帖） |
| POST | `/threads` | Auth | 创建主题帖草稿（事务内创建 Thread + OWNER + 默认子贴 + 可选正文 kind=BODY，published=false）。每用户最多 10 条未发布草稿，超限返回 BAD_REQUEST |
| GET | `/threads` | Public | 主题帖列表（仅已发布帖），每帖含 `preview` 截断纯文本（`truncateMarkdown` 处理默认子贴正文 kind=BODY，~100 字；空段落标记不会泄漏） |
| GET | `/threads/:id` | OptionalAuth | 详情（含子贴列表和标签）。公开已发布帖允许匿名访问；未发布帖仅 owner 可查看；PRIVATE 帖非成员 404。登录时附加 `isBookmarked`、`bookmarkId`、`isLiked` |
| PATCH | `/threads/:id` | Auth | 修改（OWNER/COLLABORATOR，乐观锁）；visibility、published 仅 OWNER，已发布帖不可撤回草稿 |
| DELETE | `/threads/:id` | Auth | 删除（仅 OWNER）。草稿帖硬删除（级联），已发布帖软删除 |
| POST | `/threads/:id/like` | Auth | 点赞主题帖（幂等，不通知自己） |
| DELETE | `/threads/:id/like` | Auth | 取消点赞主题帖（幂等） |
| POST | `/threads/:id/invite-link` | Auth | 生成/刷新私密帖邀请链接（需已发布，仅 OWNER） |
| GET | `/threads/join-by-link/:token` | AuthRead | 预览邀请链接对应的私密帖概要并返回 `alreadyJoined`（不创建成员） |
| POST | `/threads/join-by-link/:token` | Auth | 幂等地通过邀请链接加入私密帖（需已发布） |
| GET | `/threads/:threadId/members` | OptionalAuth | 参与人列表；按主题帖可见性校验 |
| POST | `/threads/:threadId/members/join` | Auth | 自由加入（兼容旧客户端，deprecated；Web 不提供入口） |

> 主题帖稳定访问链接为 `/threads/{threadId}`，由前端根据详情响应中的 `id` 生成；复制主题帖链接不新增后端端点。
| PATCH | `/threads/:threadId/members/:userId` | Auth | OWNER 可任免协作者；OWNER/COLLABORATOR 可修改玩家标记 |
| DELETE | `/threads/:threadId/members/me` | AuthRead | 主动退出（取消自己的 playerMarked），OWNER 不可退出 |
| GET | `/threads/:threadId/tags` | OptionalAuth | 主题帖标签列表；按主题帖可见性校验 |
| POST | `/threads/:threadId/tags` | Auth | 添加标签（OWNER/COLLABORATOR） |
| DELETE | `/threads/:threadId/tags/:tagId` | Auth | 移除标签 |

## 核心业务规则

### 草稿与发布

- 创建草稿：`POST /threads` 事务内创建 Thread(published=false) + OWNER（playerMarked=true）+ 默认子贴（sortOrder=0）。`content` 可选传入默认子贴正文（创建 kind=BODY 正文帖）。`subthreadTitle` 可选，默认定值同 title；title 缺省为"未命名草稿"
- 草稿上限：每用户最多持有 **10 条**未发布草稿（`published=false` 且未删除）。超限时 `POST /threads` 返回 `BAD_REQUEST`（"草稿数量已达上限（10/10）"），须先发布或删除旧草稿；已有超出上限的历史草稿不受影响，清理后自动恢复。配合定时任务每天清理 7 天未发布草稿作为兜底
- 沙盒迭代：楼主可在草稿内自由创建更多子贴（`POST subthreads`）、撰写楼层（`POST posts`），所有端点自动保存
- 草稿列表：`GET /threads/draft` 返回当前用户所有未发布帖，按 createdAt DESC 排序
- 发布校验：`PATCH /threads/:id { published: true }` 时校验 —— ① title 非空且非默认值"未命名草稿" ② category 已设置 ③ 默认子贴存在且有正文（存在 kind=BODY 的正文帖）
- 草稿期各 Post 的内联骰子节点只保存在 `content` 中；发布事务会锁定 Thread，校验并结算全部帖子节点后才翻转 `published=true`，任一步失败整体回滚
- 发布后通知：校验通过后先回放草稿期内全部帖子的 post.created 事件（补解析 @提及和通知），再通知创建者的所有粉丝（thread_created 类型）
- 草稿内发帖不触发 @提及解析和通知（`post.created` 事件仅在已发布帖下发帖时发射）
- 草稿仅 owner 可查看和操作，非 owner 访问返回 404
- 草稿帖删除为硬删除（级联删除子贴/帖子/参与人），已发布帖删除为软删除

### 列表与详情

- 列表接口 `findAll`：仅返回 published=true 的帖；`filter=all`(默认)仅 PUBLIC 帖；`filter=playing`返回被其他楼主标记为玩家（playerMarked=true）的帖（含私密帖，排除自己创建的帖），需登录。每帖含 `preview` 字段（truncateMarkdown 截断默认子贴正文 kind=BODY，纯文本，~100 字），不再返回 `bodyPost.content` 全文
- 发布校验会拒绝纯空白、仅顶层空段落或仅分隔线正文；图片、代码块等非空 Markdown 可发布。草稿正文仍可暂存为空，数据库字段与 Markdown 存储格式不变。
- 详情接口 `findById`：未发布帖仅 owner 可查看且不递增 viewCount；已发布帖 viewCount 异步 +1（Redis 计数器 + DB），PRIVATE 帖非参与人返回 404；登录态附加 `isBookmarked` / `bookmarkId`（浅拷贝返回，不写入共享响应缓存）
- 排序规则：
  - `sort=created`（默认）：置顶优先，其次按 createdAt DESC
  - `sort=active`：置顶优先，其次按 updatedAt DESC
  - `sort=smart`：基于热度公式（Hacker News 变体）从 Redis ZSET 前缀扫描 + 可见帖累进切片
- Cursor 分页：limit 默认 20 最大 50；created/active 用 ID cursor，smart 用「已消费可见帖数」cursor（单调累进）
- **smart 分页防重复**：ZSET 存全部帖子（含各分类），若按 ZSET 原始偏移做窗口分页，分类筛选（NATION/RPG/DEDUCTION 等稀疏分类）会使相邻窗口重叠、同一帖被多页返回。现改为：每次取 ZSET 足够长的前缀（不足时循环扩大），SQL 过滤（分类/标签/可见性）后按 ZSET 序排列，从 `consumed` 处切片 take 个，保证每帖只出现一次；前端 ThreadList 另按 id 兜底去重

### 参与人管理

- 参与人（`PARTICIPANT`）本质是楼主的**玩家候选人池**：用户无需手动加入，发帖时自动 upsert 为参与人（`PostsService.create`），公开帖 Web 不提供手动加入入口
- `_count.members` 统计候选池总数；`_count.players` 统计被授予玩家身份（`playerMarked=true`）的人数，供前端展示"玩家数"（Prisma `_count` 无法给关系计数别名，由服务层 `attachPlayerCounts()` 单独 `groupBy` 合并）
- 修改和删除使用乐观锁（version 字段），并发冲突返回 "主题帖已被修改，请刷新后重试"
- 参与人管理权限：OWNER 可任免协作者，OWNER/COLLABORATOR 可授予/收回玩家身份；不能修改/收回 OWNER；不提供删除参与人记录的操作
- 升为协作者、取消玩家标记或主动退出玩家身份会在同一事务清理失效 USER 订阅；成员资格永久保留
- 私密帖禁止自由加入，仅可通过邀请链接加入；成员资格不会被移出
- CLOSED、FINISHED 仅展示状态，不改变访问或发言权限
- 收回玩家身份：取消该参与人的 playerMarked 标记。参与人记录保留，仍可浏览和在 PARTICIPANTS 策略子贴中发帖
- 玩家身份决定 PLAYERS 策略子贴的发帖权限，详见子贴文档

### 邀请链接

- 仅已发布的私密帖可生成邀请链接（未发布或公开帖均禁止）
- `GET /threads/join-by-link/:token`：预览端点（`@AuthRead()`），返回帖子概要（title / category / owner / memberCount）和当前用户的 `alreadyJoined`；前端对已加入用户直接跳转主题帖，不停留在接受邀请页
- `POST /threads/join-by-link/:token`：正式加入（`@Auth()`），角色为 PARTICIPANT（参与人）；使用唯一键 upsert 保证重复点击和并发请求幂等，已加入时直接返回现有成员记录
- 邀请链接使用 ThreadInvite 表 upsert，token 为随机 16 位小写字母+数字

### 点赞

- `POST /threads/:id/like` 点赞主题帖；`DELETE /threads/:id/like` 取消点赞
- 点赞使用 `ThreadLike` 记录防重（`@@unique([threadId, userId])`），重复点赞幂等返回当前帖
- `Thread.likeCount` 维护在 Thread 表上（反范式），通过事务内 create ThreadLike + increment likeCount 保持一致性
- Redis `thread:{id}:stats` 的 `likes` 字段同步维护，供智能排序公式使用
- 点赞通知发送给楼主（不通知自己），包含拉黑过滤；通知聚合采用 X/Twitter 风格（同帖同类型未读通知聚合为一条，已读后新赞新建）
- 草稿帖不支持点赞（`published=false` 时返回错误）
- 点赞/取消点赞发射 `thread.liked` / `thread.unliked` 事件，更新 Redis 智能排序分并失效缓存

## Thread 与 Subthread 的关系

### 数据模型

```
Thread ──1:N── Subthread ──1:N── Post
  │                  │
  └── Post（冗余引用）──┘
```

- `Thread` 是帖子的元数据容器（title / category / visibility / published）——**不放任何正文内容**
- `Subthread` 是帖内的子版块（如"设定区""角色卡区""剧情区"），每个子贴有独立的标题、排序 (`sortOrder`) 和发帖权限策略 (`postingPolicy`)
- `Post` 同时持有 `threadId` 和 `subthreadId`，即每个楼层必须归属某个子贴，不存在游离于所有子贴之外的帖子

### 内容载体

| 实体 | 是否有内容 | 说明 |
|------|-----------|------|
| Thread | 无 | 仅元数据 + likeCount。列表卡片展示通过第一个子贴间接获取 |
| Subthread | 部分有 | 创建时可选附带正文（kind=BODY 帖）；也可以是空子贴，后续通过发帖填充 |
| Post | 有 | 正文唯一载体，`content` 为 Markdown 字符串 |

### 默认子贴

每个 Thread 有一个**默认子贴**，通过 `Thread.defaultSubthreadId` 外键显式标记（数据库级 enforce）：

| 规则 | 说明 |
|------|------|
| 创建时机 | `POST /threads` 事务内自动创建，sortOrder 固定为 0 |
| 排序锁定 | 不可通过 PATCH /subthreads 修改 sortOrder |
| 不可删除 | 默认子贴不可单独删除，需删除整个主题帖 |
| 拖拽首位 | 批量重排时首项必须是默认子贴 |
| 列表展示 | `GET /threads` 通过默认子贴的 `kind=BODY` 正文帖（`posts[0].content`）生成 preview 字段；列表响应中 `defaultSubthread` 不携带 `bodyPost` |
| 回退机制 | 若单独创建子贴（非通过 POST /threads），首个创建的子贴自动补设为默认 |

默认子贴的设计意图是充当帖子的"主内容区"——即便楼主创建了多个子贴用于不同话题，始终有一个固定的首版块用于主要讨论。

### 创建与发布联动

```
POST /threads          → 事务: Thread(published=false) + OWNER + 默认子贴 + [正文 kind=BODY]
                          [一次请求完成，无需额外创建子贴]

POST subthreads        → Subthread + 可选正文帖（kind=BODY，正文为空时仅子贴）
  GET /subthreads      → 查看已创建的子贴及其帖子数量

POST posts             → 在子贴下新增楼层，自动记入该子贴
  ↑ 仅 published=true 时触发 post.created 事件

PATCH published=true   → 发布前校验：
                         ① title 非空
                         ② category 已选
                         ③ 默认子贴有正文
                         → 回放草稿帖事件（@提及+通知）
                         → 通知所有粉丝
```

### 级联删除

| 操作 | 效果 |
|------|------|
| 删除草稿 Thread → | 级联删除所有 Subthread + Post + ThreadMember + ThreadInvite + ThreadTopicTag |
| 删除已发布 Thread → | 软删除（设 deletedAt），关联数据保留 |
| 软删除 Subthread → | 子贴设为 deletedAt，其下 Post 保留但通过 `deletedAt: null` 过滤 |
| 硬删除 Subthread → | PostgreSQL ON DELETE CASCADE 级联删除其 Post |

### 访问控制传递链

```
ThreadAccessService.assertAccessible(threadId, userId)
  ├── Thread 已删除 → 404
  ├── Thread 未发布 + 非 owner → 404
  ├── Thread 已发布 + visibility=PRIVATE + 非参与人 → 404
  └── 放行
       ↓
  SubthreadsService / PostsService 所有读方法均调用此入口
       ↓
  发帖写入时额外检查 postingPolicy（PARTICIPANTS / COLLABORATORS / PLAYERS）
```

### 列表与详情数据聚合

| 视图 | 子贴信息 | 帖子信息 |
|------|---------|---------|
| Thread 列表 (`findAll`) | 通过 defaultSubthreadId 取默认子贴的 id / title / lastPostAt + bodyPost.content → truncateMarkdown 生成 preview | `_count.members`（候选池）+ `_count.players`（玩家）+ `_count.posts`（楼层数，正文不计入） |
| Thread 详情 (`findById`) | 全部子贴列表 + `_count.posts` + `bodyPost`（正文帖 id/content/version，供编辑器回填） | 正文通过 PUT `/subthreads/:id/body` upsert 写入 |
| Subthread 列表 (`findAll`) | 按 sortOrder 排列 + `_count.posts` | 不返回正文 |
| Subthread 详情 (`findById`) | 单个子贴 + `_count.posts` | 不返回正文 |
| Post 列表 (`findAllBySubthread`) | 已通过 threadAccess 校验 | 楼层列表（Cursor 分页） |

## 设计决策

- **草稿沙盒**：Thread 本身即为沙盒 —— published=false 时帖子不对外，楼主可在沙盒内任意搭建子贴、撰写楼层。发布时仅翻转 published 标记，数据零迁移
- **发布即校验**：创建草稿时零必填字段，所有完整性校验推迟到发布时刻。这样用户可以分步填写、随时退出、续接编辑
- **草稿内不发通知**：发帖事件（post.created）仅在已发布帖下发帖时发射，草稿内的所有操作不触发 @提及解析和通知。通知逻辑移至 publish 时刻（thread_created 通知粉丝）
- **未发布帖硬删除**：草稿帖数据尚未对外发布，硬删除可直接级联清理所有关联的子贴/帖子/参与人。定时任务每天凌晨 4 点清理超过 7 天未发布的草稿
- **乐观锁 version**：比悲观锁更适合读多写少的协作编辑场景；使用 Prisma 的 where { version } + data { version: increment: 1 } 实现原子比较并更新
- **viewCount 异步更新**：不阻塞详情接口的返回，使用 fire-and-forget catch，牺牲极端情况下的精度换取响应速度。未发布帖不递增 viewCount。同时维护 Redis 计数器 `thread:{id}:stats` 的 views 字段供智能排序
- **访问权限统一入口**：`ThreadAccessService.assertAccessible()` 为所有主题帖读写的统一入口（含软删除 / 未发布 / 私密帖校验），`assertCanManage()` 统一 OWNER/COLLABORATOR 管理权限校验。所有服务层（ThreadsService / SubthreadsService / ThreadMembersService）和标签控制器均复用此服务，不再重复实现
- **智能排序**：采用 Hacker News 热度算法变体 `score = (replies * 2 + likes * 3 + views * 0.3) / (age_hours + 2)^1.5`。每次发帖/点赞/浏览通过事件监听器实时更新 Redis ZSET 分数，每 10 分钟全量重算修正精度漂移。查询时从 ZSET 前缀扫描取 ID 列表，再经 SQL 过滤（分类/标签/可见性）后按 ZSET 顺序归位，按「已消费可见帖数」切片输出（每帖只出现一次，避免分类筛选下相邻窗口重叠重复）
