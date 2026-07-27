# 温油站后端架构与技术选型

## 1. 项目定位

温油站是一个面向文字接力、角色扮演、国策、数据流等自由玩法的共同创作社区。

核心内容层级：

```text
主题 Thread
└─ 分帖 Subthread
   └─ 楼层 Post
      └─ 楼中楼回复 Reply
```

- 主题：一个共同创作项目。
- 分帖：主题下独立计数的一组回复串。
- 楼层：分帖中的正式内容单位。
- 标签：主题内自由创建，用于筛选分帖；平台不预设固定玩法。

后端采用“模块化单体”架构：首期部署、调试与维护成本低；未来若任务处理压力增加，再单独拆出 Worker。

---

## 2. 技术选型

| 层级 | 选型 | 原因 |
|---|---|---|
| 运行时 | Node.js 当前 LTS + TypeScript | 与 Web、Expo 客户端共享语言生态 |
| 后端框架 | NestJS + Fastify Adapter | NestJS 负责模块化、依赖注入、鉴权、Swagger；Fastify 作为轻量 HTTP 运行层 |
| API 风格 | REST + OpenAPI | 更适合 Web、移动端和后台共用；自动生成客户端 |
| 数据库 | PostgreSQL | 适合用户、主题、分帖、楼层、标签、权限等关系模型 |
| ORM | Prisma | 类型安全、迁移清晰、事务与关联查询完善 |
| 缓存与队列 | Redis + BullMQ + `@nestjs/bullmq` | 处理邮件、通知、图片、审核等异步任务 |
| 认证 | Passport JWT + Argon2 | 标准、安全、可扩展 |
| 参数校验 | `class-validator` + `class-transformer` | 与 NestJS DTO 和 Swagger 集成自然 |
| 图片存储 | 腾讯 COS 香港 + S3 SDK | 客户端直传，服务器不承载大文件流量 |
| 邮件 | 腾讯 SES + Nodemailer | 注册验证、找回密码、通知邮件 |
| 日志 | Pino + `nestjs-pino` | 结构化日志，便于排查 |
| 错误监控 | Sentry | 集中收集线上异常 |
| 健康检查 | `@nestjs/terminus` | 提供 `/health` 给部署平台检查 |

NestJS 原生覆盖 OpenAPI、认证、授权、限流、队列、WebSocket、任务调度等常见能力。[NestJS 文档](https://docs.nestjs.com/openapi)  
Prisma 支持事务和模型自关联，适合楼中楼与并发楼层编号分配。[事务文档](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)，[自关联文档](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations)  
BullMQ 基于 Redis，支持失败重试、延迟任务和 Worker 并发处理。[BullMQ 文档](https://docs.bullmq.io/)

---

## 3. 不采用的方案

首期明确不引入：

```text
微服务
Kubernetes
Kafka
Elasticsearch
GraphQL
复杂实时聊天
自建邮件服务器
自建对象存储
通用游戏规则引擎
```

原因：温油站早期并发有限，复杂基础设施不会带来核心产品价值。

---

## 4. 模块划分

```text
src/
├─ app.module.ts
├─ config/               # 环境变量、配置校验
├─ common/               # 通用异常、分页、权限、响应结构
├─ prisma/               # PrismaService、迁移辅助
├─ auth/                 # 注册、登录、JWT、邮箱验证、找回密码
├─ users/                # 用户资料、头像、封禁、拉黑
├─ threads/              # 主题创建、成员、协作者、状态
├─ subthreads/           # 分帖、排序、标签筛选、读写设置
├─ tags/                 # 主题内标签与分帖标签关联
├─ posts/                # 楼层、楼中楼、编辑、软删除、楼层编号
├─ mentions/             # 正文 @ 提及解析与通知
├─ drafts/               # 自动保存草稿
├─ media/                # COS 临时上传凭证、附件元数据
├─ notifications/        # 站内通知、未读数、邮件投递
├─ reports/              # 举报、处理流程
├─ moderation/           # 敏感词、隐藏、禁言、审核记录
├─ jobs/                 # BullMQ Producer 与 Worker
├─ health/               # 数据库、Redis、对象存储健康检查
└─ admin/                # 管理后台专用 API
```

每个模块只处理一个明确领域。禁止在 Controller 中直接编写跨模块业务逻辑。

---

## 5. 核心数据模型原则

### 主题与成员

```text
Thread
ThreadMember
```

`ThreadMember.role`：

```text
OWNER
COLLABORATOR
PARTICIPANT
READER
```

主题状态：

```text
ACTIVE
PAUSED
ARCHIVED
```

不做细粒度 ACL。分帖只保留：

```text
visibility: PUBLIC | MEMBERS
postingPolicy: COLLABORATORS | PARTICIPANTS
```

### 分帖与标签

```text
Subthread
Tag
SubthreadTag
```

标签只在单个主题内存在，不做全站公共标签。

```text
Thread → 多个 Subthread
Thread → 多个 Tag
Subthread ↔ 多个 Tag
```

标签只负责筛选、聚合和导航，不影响权限或业务规则。

### 楼层与回复

```text
Post
```

关键字段：

```text
id
thread_id
subthread_id
author_id
floor_number
parent_post_id
reply_to_post_id
content_markdown
status
created_at
updated_at
deleted_at
```

约束：

```text
(subthread_id, floor_number) 唯一
```

- `floor_number` 在分帖内递增且永不复用。
- `parent_post_id` 用于楼中楼关系。
- `reply_to_post_id` 记录用户点“回复”时的对象，为未来升级保留。
- 删除使用软删除；旧链接和回复树仍可保持完整。
- 首期不实现正文内“引用第 N 楼并跳转”的复杂引用系统。

发帖时必须使用数据库事务分配楼层号并创建楼层，避免并发下重复编号。

### @ 提及与回复

两者必须分开：

```text
回复：reply_to_post_id，通知“有人回复了你”
@提及：PostMention，通知“有人提到了你”
```

正文中的 `@用户名` 由后端解析并保存到：

```text
PostMention
├─ post_id
└─ mentioned_user_id
```

如果回复对象与正文提及对象相同，只发送一条回复通知。

---

## 6. API 规范

统一使用：

```text
/api/v1
```

示例：

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/verify-email

GET    /threads
POST   /threads
GET    /threads/:threadId
PATCH  /threads/:threadId

POST   /threads/:threadId/members
PATCH  /threads/:threadId/members/:userId

GET    /threads/:threadId/subthreads
POST   /threads/:threadId/subthreads
PATCH  /subthreads/:subthreadId

GET    /subthreads/:subthreadId/posts
POST   /subthreads/:subthreadId/posts
PATCH  /posts/:postId
DELETE /posts/:postId

POST   /drafts
GET    /notifications
POST   /media/upload-url
POST   /reports
GET    /health
```

规则：

- 列表接口使用 cursor 分页，不使用大偏移量分页。
- 统一返回错误码、字段错误和追踪 ID。
- 所有 DTO 必须校验。
- Swagger 仅在开发环境或管理员受保护入口公开。
- OpenAPI 文档作为 Web 与移动端接口生成的唯一来源。

---

## 7. 异步任务

不要在用户请求中同步发送邮件、压缩图片或调用审核服务。

使用 BullMQ 队列：

```text
email
notification
media
moderation
maintenance
```

任务示例：

```text
email.verify
email.reset-password
notification.reply
notification.mention
media.process-image
moderation.check-post
maintenance.cleanup-expired-drafts
maintenance.daily-backup
```

规则：

- 任务必须可重试、幂等。
- 网络类失败使用指数退避重试。
- 业务不可恢复错误直接进入失败队列。
- Worker 可与 API 同机运行；后期可单独拆为 Worker 容器。
- 不使用已废弃的 BullMQ `QueueScheduler`。

---

## 8. 安全基线

必须从第一版具备：

```text
密码使用 Argon2 哈希
短期 Access Token + 可轮换 Refresh Token
邮箱验证 Token 仅存哈希，且有过期时间
登录、注册、发帖、回复、上传分别限流
PostgreSQL 与 Redis 不暴露公网端口
COS 使用临时上传 URL，不把永久密钥给客户端
Markdown 禁止原始 HTML 或严格清洗
敏感配置仅存于环境变量
所有删除默认软删除
管理员操作记录审计日志
```

上传限制：

```text
允许 MIME 类型白名单
限制文件大小、像素尺寸与总附件数
图片上传后异步压缩与生成缩略图
附件对象路径按用户与日期隔离
```

---

## 9. 部署框架

```text
Git develop → dev.example.com
Git main    → app.example.com
```

开发与生产必须使用不同的：

```text
PostgreSQL 数据库
Redis 实例或逻辑库
COS Bucket
JWT 密钥
邮件配置
环境变量
```

容器划分：

```text
api
worker
postgres
redis
reverse-proxy / Dokploy
```

对外只开放：

```text
80
443
22
```

数据库、Redis、Worker 管理端口不开放公网。

---

## 10. 首期开发顺序

```text
1. 项目骨架、配置、Docker、Prisma、健康检查
2. 用户注册、登录、邮箱验证
3. 主题、成员、协作者
4. 分帖、自由标签、排序与筛选
5. 楼层、楼中楼、独立楼层编号
6. Markdown、草稿、图片上传
7. @提及、回复通知、未读数
8. 举报、限流、软删除、后台基础能力
9. 日志、Sentry、备份、开发环境部署
```

首个验收目标：

> 两名用户能够注册、创建一个主题、建立多个分帖、为分帖添加自由标签、发布 Markdown 楼层、在楼中楼回复、@ 对方、保存草稿，并在刷新后继续阅读。

---
