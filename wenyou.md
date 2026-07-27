# 温油站后端 — 架构、设计与开发计划

## 1. 项目定位

温油站是一个面向文字接力、角色扮演、国策、数据流等自由玩法的共同创作社区。

### 核心内容层级

```
故事帖 Thread (分区: 演绎/国策/RPG)
├─ 子贴 "设定区"
│  ├─ 1 楼 (子贴正文)
│  └─ 2 楼 → 楼中楼回复串 (平级, 不限制深度)
├─ 子贴 "角色报名区"
│  ├─ 1 楼
│  └─ 2 楼
└─ 子贴 "游玩区"
   ├─ 1 楼
   └─ 2 楼
```

- **主题帖**：一个共同创作项目，创建时必选分区，默认自带第一个子贴，子贴第一楼为正文
- **子贴**：主题下独立计数的一组回复串，每个子贴楼层编号从 1 开始
- **楼中楼**：平级挂载在楼层下，所有回复共享 `parentPostId`，不限制嵌套深度，回复串中所有条目平级
- **主题帖标签**：平台级，用户自定义（如 `#无限流`、`#数据流`），跨主题帖搜索筛选
- **子贴标签**：主题帖内自由创建，用于该故事帖内部子贴分类

### 两套独立标签系统

| 标签类型 | 作用域 | 模型 |
|----------|--------|------|
| 主题帖标签 | 平台全局，用于首页分区内搜索筛选 | `TopicTag` + `ThreadTopicTag` |
| 子贴标签 | 单个主题帖内部，用于子贴分类 | `SubthreadTagDef` + `SubthreadTag` |

两者不能混用。

### 首期不引入

微服务 / Kubernetes / Kafka / Elasticsearch / GraphQL / 复杂实时聊天 / 自建邮件服务器 / 自建对象存储 / 通用游戏规则引擎 / 敏感词过滤

---

## 2. 技术选型

| 层级 | 选型 | 原因 |
|------|------|------|
| 运行时 | Node.js 当前 LTS + TypeScript | 与 Web、Expo 客户端共享语言生态 |
| 后端框架 | NestJS + Fastify Adapter | NestJS 负责模块化、依赖注入、鉴权、Swagger；Fastify 作为轻量 HTTP 运行层 |
| API 风格 | REST + OpenAPI | 更适合 Web、移动端和后台共用；自动生成客户端 |
| 数据库 | PostgreSQL | 适合用户、主题、分帖、楼层、标签、权限等关系模型 |
| ORM | Prisma | 类型安全、迁移清晰、事务与关联查询完善 |
| 缓存与队列 | Redis + BullMQ + `@nestjs/bullmq` | 处理邮件、通知、图片、审核等异步任务 |
| 认证 | Passport JWT + Argon2 | 标准、安全、可扩展 |
| 参数校验 | `class-validator` + `class-transformer` | 与 NestJS DTO 和 Swagger 集成自然 |
| 图片存储 | 腾讯 COS 香港 + S3 SDK | 客户端直传，服务器不承载大文件流量 |
| 图片处理 | sharp | 压缩、纠正方向、生成缩略图 |
| 邮件 | 腾讯 SES + Nodemailer | 仅用于注册验证、找回密码 |
| 日志 | Pino + `nestjs-pino` | 结构化日志，便于排查 |
| 错误监控 | Sentry | 集中收集线上异常 |
| 健康检查 | `@nestjs/terminus` | 提供 `/health` 给部署平台检查 |
| 管理后台 | AdminJS (`@adminjs/nestjs`) | 零代码读 Prisma Schema 自动生成 CRUD 页面 |

---

## 3. 产品设计决策

### 3.1 可见性与访问

- 全部内容默认公开，未登录用户可浏览所有主题帖、子贴、楼层
- 子贴有 `visibility: PUBLIC | MEMBERS` 控制可见范围

### 3.2 参与模式

- **自由加入**：任何人随时可在任何位置发言，无需申请
- **玩家标记**：楼主审核赋予的身份标签，纯功能意义（仅用于 `postingPolicy` 权限判断）
- **子贴发言权限**：楼主可为特定子贴设置 `postingPolicy: COLLABORATORS | PARTICIPANTS`
- **子贴管理权限**：仅 OWNER / COLLABORATOR 可增删改子贴
- **协作者**：自由邀请制，可管理子贴、标签、踢人
- 成员角色：`OWNER` / `COLLABORATOR` / `PARTICIPANT`（无 READER 角色）

### 3.3 内容编辑与删除

- **自由编辑**：任意时刻可改，不锁窗口
- **编辑记录显示**：
  - 一天内：`编辑于 X 分钟/小时前`
  - 一年内：`编辑于 月-日`
  - 超过一年：`编辑于 年-月-日`
- **软删除**：删除后内容从流中消失，他人不可见
- **子贴正文删除**：二次确认后连带删除整个子贴
- **回复长度**：最多 10,000 字，楼层与楼中楼无差别

### 3.4 用户系统

- **注册**：需邮箱验证后才能发帖（未验证可浏览）
- **头像**：默认字母色块头像 + 可选上传（暂不审核）
- **用户主页**：展示创建的主题（始终可见）+ 最近回复/玩家身份/收藏（用户可开关）
- **拉黑**：双向阻止 — 不通知 + 不能在对方帖子里发言
- **邮件用途**：仅注册验证和找回密码，日常通知走站内

### 3.5 通知与订阅

- **站内通知**（不走邮件）：
  - 新建子贴 / 新楼层 → 通知楼主和协作者
  - @提及 / 被回复 → 通知相关用户
- **订阅**（仅被标记为玩家的用户可用）：
  - 订阅"某用户在该主题帖下的全部回复"
  - 订阅"整个主题帖的全部回复"
  - 通过 BullMQ 队列异步生成通知

### 3.6 首页与发现

- **分区 Tab**：演绎 / 国策 / RPG
- **三种排序**：
  - **推荐**（默认）：加权热度公式 `(成员数×10 + 楼层数×1 + 今日回复×3) / 时间衰减`
  - **最新**：按创建时间倒序
  - **活跃**：按最近回复时间倒序
- **标签筛选**：通过主题帖标签跨主题搜索（如 `?tag=无限流`）

### 3.7 草稿

- 每用户每子贴 **5 个草稿位**（slot 1-5）
- **自动保存**：选空闲位持续更新
- **手动保存**：显式选择草稿位
- 客户端本地 IndexedDB / Flutter 本地数据库 + 服务端同步

### 3.8 主题帖创建流程

1. 填写标题、正文、必选分区（演绎/国策/RPG）、可选主题帖标签
2. 后端事务内：创建 Thread → 创建首个 Subthread → 创建第一楼 Post → 创建 OWNER 成员记录
3. 创建后分区可改

### 3.9 举报与管理

- 举报发到后台，人工逐个处理
- 管理后台用 AdminJS 省事生成
- 首期不做敏感词过滤

---

## 4. 核心数据模型

### 完整表结构 (19 张表)

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| `User` | 用户 | email, username, password(Argon2), nickname, avatar, bio, role, emailVerified, privacySettings |
| `Thread` | 主题帖 | title, content, category(DEDUCTION/NATION/RPG), status(ACTIVE/PAUSED/ARCHIVED), ownerId |
| `ThreadMember` | 成员 | threadId, userId, role(OWNER/COLLABORATOR/PARTICIPANT), playerMarked |
| `Subthread` | 子贴 | threadId, title, sortOrder, visibility, postingPolicy, lastPostAt |
| `SubthreadTagDef` | 子贴标签定义 | threadId, name, color (主题帖内唯一) |
| `SubthreadTag` | 子贴 ↔ 标签关联 | subthreadId, tagId |
| `Post` | 楼层/楼中楼 | threadId, subthreadId, authorId, floorNumber, parentPostId, replyToPostId, content, status, deletedAt |
| `PostMention` | @提及记录 | postId, mentionedUserId |
| `Draft` | 草稿 | userId, subthreadId, slot(1-5), content |
| `Notification` | 站内通知 | userId, type, content, referenceId, isRead |
| `TopicTag` | 主题帖标签（平台级） | name, color |
| `ThreadTopicTag` | 主题帖 ↔ 标签关联 | threadId, topicTagId |
| `Subscription` | 订阅 | userId, threadId, targetUserId?(可选), type(THREAD/USER) |
| `UserBlock` | 拉黑 | blockerId, blockedId |
| `UserReadProgress` | 阅读进度 | userId, subthreadId, postId(精确到楼中楼) |
| `Report` | 举报 | reporterId, targetType, targetId, reason, status, handledBy, handledAt |
| `AuditLog` | 审计日志 | adminId, action, targetType, targetId, detail, ip |
| `EmailVerification` | 邮箱验证 | userId, token(哈希), expiresAt |

### 核心关系图

```
User ──< Thread (owner)
User ──< ThreadMember
User ──< Post (author)
User ──< Draft
User ──< Notification
User ──< UserReadProgress
User ──< PostMention (mentionedUser)
User ──< UserBlock (blocker)
User ──< UserBlock (blocked)

Thread ──< ThreadMember
Thread ──< Subthread
Thread ──< SubthreadTagDef
Thread ──< ThreadTopicTag
Thread ──< Post

Subthread ──< SubthreadTag
Subthread ──< Post
Subthread ──< UserReadProgress

SubthreadTagDef ──< SubthreadTag

TopicTag ──< ThreadTopicTag

Post ──< Post (parentPost: PostReplies)
Post ──< Post (replyToPost: ReplyTo)
Post ──< PostMention
```

### 楼层编号约束

- `(subthread_id, floor_number)` 唯一
- `floor_number` 在子贴内递增且永不复用
- 发帖时必须使用数据库事务分配楼层号，避免并发重复编号
- user_read_progress.postId 指向具体 Post，无论主楼层还是楼中楼

---

## 5. API 规范

- Base URL: `/api/v1`
- 错误格式: `{ statusCode, message, timestamp, path }`
- 分页: cursor-based
- Swagger 文档: `/api/docs` (仅 dev 环境)
- 所有 DTO 必须 class-validator 校验

### 完整 API 端点规划

| 方法 | 路径 | 说明 | 认证 | Phase |
|------|------|------|------|-------|
| GET | `/health` | 健康检查 | 否 | ✅ 1 |
| POST | `/auth/register` | 注册 | 否 | ✅ 2 |
| POST | `/auth/login` | 登录 | 否 | ✅ 2 |
| POST | `/auth/refresh` | 刷新 Token | 否 | ✅ 2 |
| POST | `/auth/verify-email` | 邮箱验证 | 否 | 3 |
| POST | `/auth/forgot-password` | 忘记密码 | 否 | 6 |
| GET | `/users/me` | 当前用户 | 是 | ✅ 2 |
| PATCH | `/users/me` | 修改资料 | 是 | ✅ 2 |
| GET | `/users/:id` | 用户公开信息 | 否 | ✅ 2 |
| POST | `/users/me/block/:id` | 拉黑用户 | 是 | 7 |
| DELETE | `/users/me/block/:id` | 取消拉黑 | 是 | 7 |
| GET | `/tags` | 搜索主题帖标签 | 否 | 3 |
| POST | `/tags` | 创建主题帖标签 | 是 | 3 |
| GET | `/threads` | 分区列表 | 否 | 3 |
| POST | `/threads` | 创建主题帖 | 是 | 3 |
| GET | `/threads/:id` | 主题帖详情 | 否 | 3 |
| PATCH | `/threads/:id` | 修改主题帖 | 是 | 3 |
| DELETE | `/threads/:id` | 软删除 | 是 | 3 |
| GET | `/threads/:id/members` | 成员列表 | 否 | 3 |
| POST | `/threads/:id/members/join` | 加入 | 是 | 3 |
| POST | `/threads/:id/members` | 邀请 | 是 | 3 |
| PATCH | `/threads/:id/members/:userId` | 修改角色/玩家 | 是 | 3 |
| DELETE | `/threads/:id/members/:userId` | 踢出 | 是 | 3 |
| GET | `/threads/:id/tags` | 主题帖标签 | 否 | 3 |
| POST | `/threads/:id/tags` | 添加标签 | 是 | 3 |
| DELETE | `/threads/:id/tags/:tagId` | 移除标签 | 是 | 3 |
| GET | `/threads/:id/subthreads` | 子贴列表 | 否 | 4 |
| POST | `/threads/:id/subthreads` | 创建子贴 | 是 | 4 |
| PATCH | `/subthreads/:id` | 修改子贴 | 是 | 4 |
| DELETE | `/subthreads/:id` | 删除子贴 | 是 | 4 |
| GET | `/subthreads/:id/tags` | 子贴标签 | 否 | 4 |
| POST | `/subthreads/:id/tags` | 添加标签 | 是 | 4 |
| DELETE | `/subthreads/:id/tags/:tagId` | 移除标签 | 是 | 4 |
| GET | `/subthreads/:id/posts` | 楼层列表 | 否 | 5 |
| POST | `/subthreads/:id/posts` | 发帖（楼层/楼中楼） | 是 | 5 |
| PATCH | `/posts/:id` | 编辑帖子 | 是 | 5 |
| DELETE | `/posts/:id` | 软删除 | 是 | 5 |
| GET | `/drafts` | 草稿列表 | 是 | 6 |
| POST | `/drafts` | 保存草稿 | 是 | 6 |
| DELETE | `/drafts/:id` | 删除草稿 | 是 | 6 |
| GET | `/notifications` | 通知列表 | 是 | 6 |
| POST | `/notifications/read-all` | 全部已读 | 是 | 6 |
| POST | `/subscriptions` | 创建订阅 | 是 | 6 |
| GET | `/subscriptions` | 订阅列表 | 是 | 6 |
| DELETE | `/subscriptions/:id` | 取消订阅 | 是 | 6 |
| POST | `/reports` | 提交举报 | 是 | 7 |
| GET | `/reports` | 举报列表(管理) | 是(ADMIN) | 7 |
| POST | `/reports/:id/handle` | 处理举报 | 是(ADMIN) | 7 |
| POST | `/media/upload-url` | COS 临时上传凭证 | 是 | 8 |
| GET | `/admin/*` | AdminJS 管理后台 | 是(ADMIN) | 7 |

---

## 6. 模块架构

```
src/
├── app.module.ts              # 根模块
├── main.ts                    # 入口 (Fastify + Pino)
├── config/                    # 环境变量校验与配置
│   ├── configuration.ts
│   └── env.validation.ts
├── common/                    # 通用模块
│   ├── common.module.ts
│   ├── decorators/            # @Public(), @CurrentUser()
│   ├── filters/               # 全局异常过滤器
│   ├── interceptors/          # 统一响应包装器
│   ├── pipes/                 # 校验管道
│   └── dto/                   # CursorPaginationDto 等
├── prisma/                    # 数据库服务 (全局)
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── health/                    # 健康检查 (Terminus)
├── auth/                      # 认证 (Passport JWT + Argon2)
│   ├── strategies/jwt.strategy.ts
│   ├── guards/jwt-auth.guard.ts
│   ├── guards/roles.guard.ts
│   ├── decorators/roles.decorator.ts
│   └── dto/
├── users/                     # 用户资料
├── threads/                   # 主题帖 CRUD + 成员 + 玩家
│   ├── threads.module.ts
│   ├── threads.service.ts     # CRUD + 事务创建
│   ├── threads.controller.ts
│   ├── thread-members.service.ts
│   ├── thread-members.controller.ts
│   ├── thread-members.guard.ts # 协作者权限
│   ├── thread-tags.controller.ts
│   └── dto/
├── subthreads/                # 子贴 CRUD + 排序 + 标签
├── tags/                      # 标签 (TopicTag + SubthreadTagDef)
├── posts/                     # 楼层 + 楼中楼 + floorNumber 分配
├── mentions/                  # @提及解析
├── drafts/                    # 5 槽位草稿
├── media/                     # COS 临时上传凭证
├── notifications/             # 站内通知 + 未读数
├── subscriptions/             # 玩家订阅
├── reports/                   # 举报流程
├── moderation/                # 审核流程 (Phase 7)
├── jobs/                      # BullMQ Producer + Worker
│   ├── producers/
│   └── consumers/
└── admin/                     # AdminJS 管理后台
```

### 模块依赖规则

- 每个模块只处理一个明确领域
- Controller 中禁止直接编写跨模块业务逻辑
- `Threads` 不直接导入 `Posts`，通过事件/队列解耦
- `Posts` 发帖后触发通知队列任务（@解析、通知投递）
- `Auth` 的 JWT Guard 被所有需认证模块复用
- `Common` 导出装饰器、过滤器、分页 DTO，全局引用

---

## 7. 异步任务 (BullMQ)

| 队列 | 任务 | Phase |
|------|------|-------|
| `email` | `email.verify`、`email.reset-password` | 6 |
| `notification` | `notification.reply`、`notification.mention`、`notification.subscription` | 6 |
| `media` | `media.process-image`（sharp 压缩缩略图） | 8 |
| `moderation` | `moderation.check-post`（敏感词，后期） | — |
| `maintenance` | `maintenance.cleanup-expired-drafts`、`maintenance.cleanup-unverified-users` | 6 |

任务规则：
- 必须可重试、幂等
- 网络类失败使用指数退避重试
- 业务不可恢复错误直接进入失败队列
- Worker 可与 API 同机运行；后期可单独拆为 Worker 容器

---

## 8. 安全基线

- 密码 Argon2 哈希
- 短期 Access Token（15m）+ 可轮换 Refresh Token（7d）
- 邮箱验证 Token 仅存哈希且有过期时间
- 登录、注册、发帖、回复、上传分别限流（`@nestjs/throttler`）
- PostgreSQL 与 Redis 不暴露公网端口（docker-compose 绑定 127.0.0.1）
- COS 使用临时上传 URL（S3 presigned URL）
- Markdown 内容不做 HTML 渲染（客户端渲染）
- 敏感配置仅存于环境变量
- 所有删除默认软删除
- 管理员操作记录审计日志（AuditLog）
- 文件上传限制：MIME 白名单、文件大小、像素尺寸、总附件数

---

## 9. 开发顺序

### Phase 1：项目骨架 ✅ 已完成
- NestJS + Fastify + Pino + Swagger 基础
- Docker Compose (PostgreSQL 17 + Redis 7)
- Prisma Schema + Migration
- Health Check (`/api/v1/health`)
- 统一异常过滤器 + 响应拦截器 + Cursor 分页 DTO

### Phase 2：认证与用户 ✅ 已完成
- Auth 模块：注册、登录、JWT 双 Token、Argon2
- Users 模块：GET/PATCH /me、GET /:id
- UserReadProgress 表
- 全局中文注释

### Phase 3：主题帖与标签 ← 当前

| 子步骤 | 内容 | 新增表 |
|--------|------|--------|
| 3.0 | Schema 补齐：Thread.category、emailVerified、Draft.slot、TopicTag、ThreadTopicTag、Subscription、UserBlock、EmailVerification | 5 张新表 |
| 3.A | Swagger 配置 (`/api/docs`) | — |
| 3.B | 主题帖标签 (TopicTag CRUD) | — |
| 3.C1 | Thread CRUD：创建(事务4步)、列表(3种排序)、修改、删除 | — |
| 3.C2 | Thread 成员：自由加入、邀请、踢出、角色修改、玩家标记 | — |
| 3.C3 | 主题帖标签关联：增删标签 + 跨主题筛选 | — |

**Phase 3 验收**：用户 A 注册 → 创建主题帖(选分区+标签) → 第一子贴+第一楼自动生成 → 用户 B 自由加入 → A 邀请 B 为协作者 → A 标记 B 为玩家 → 首页按分区/标签/排序筛选 → 所有 API 返回正确状态码和错误格式

### Phase 4：子贴与排序
- 子贴 CRUD（仅 OWNER/COLLABORATOR）
- sortOrder 自定义排序
- 子贴标签 CRUD + 关联
- postingPolicy 权限控制
- lastPostAt 更新逻辑

### Phase 5：楼层与楼中楼
- 发帖事务（分配 floorNumber）
- 楼中楼平级挂载
- 编辑（记录 updatedAt）
- 软删除
- 子贴正文删除确认 + 级联删除子贴

### Phase 6：草稿、通知、订阅
- 5 槽位草稿 CRUD
- @提及解析（PostMention）
- 站内通知投递（BullMQ）
- 玩家订阅（订阅用户/订阅主题帖）
- 邮箱验证全流程
- 未清理的过期草稿和未验证用户定时清理

### Phase 7：举报与管理后台
- 举报提交 + 处理流程
- AdminJS 管理后台
- 用户拉黑（双向阻止）
- 角色守卫（ADMIN 权限）
- 用户主页隐私开关

### Phase 8：媒体、限流、监控
- COS 临时上传凭证 (S3 presigned URL)
- sharp 图片压缩 (BullMQ worker)
- 限流 guard (`@nestjs/throttler`)
- Sentry 错误监控

### Phase 9：部署与运维
- `api` + `worker` 容器拆分
- Dokploy / 反向代理
- 备份脚本
- 开发 vs 生产环境隔离

---

## 10. 测试与 CI 策略

| 测试层 | 工具 | 覆盖目标 | 触发时机 |
|--------|------|----------|----------|
| 单元测试 | Jest | Service 层 ≥ 60%，Guard ≥ 80% | 每个子步骤完成后 |
| e2e | Jest + supertest | 每个模块全部 CRUD 端点 | 每个 Phase 完成后 |
| 编译检查 | `pnpm build` | 0 错误 | 每次修改后 |
| ESLint | `pnpm lint` | 0 warning | 提交前 |
| 手动验证 | curl | 核心流程 | 每次 Service 启动后 |

### 首个整体验收目标

> 两名用户能够注册、创建一个主题、建立多个子贴、为子贴添加自由标签、发布 Markdown 楼层、在楼中楼回复、@ 对方、保存草稿，并在刷新后继续阅读。

覆盖：Phase 1-6 全部完成后验证。

---

## 11. 部署框架

```
Git main → app.example.com
```

容器划分：
```
api         # NestJS 应用 (无状态)
worker      # BullMQ Worker (可独立扩缩)
postgres    # PostgreSQL 17
redis       # Redis 7
reverse-proxy
```

对外只开放 80 / 443 / 22。数据库、Redis、Worker 管理端口不开放公网。

---

## 12. 环境要求

| 工具 | 版本 |
|------|------|
| Node.js | >= 24 LTS (fnm) |
| pnpm | >= 9 |
| Docker | >= 27 |
| PostgreSQL | 17 (docker) |
| Redis | 7 (docker) |

## 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 启动 PostgreSQL + Redis |
| `docker compose down` | 停止基础设施 |
| `pnpm install` | 安装依赖 |
| `pnpm start:dev` | 启动开发服务器 (watch 模式) |
| `pnpm build` | 生产构建 |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:migrate` | 运行数据库迁移 |
| `pnpm prisma:studio` | 打开 Prisma Studio |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm test` | 运行单元测试 |
| `pnpm test:e2e` | 运行 e2e 测试 |
