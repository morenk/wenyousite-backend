# 温油站后端 — 架构文档与开发指南

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

- **主题帖**：共同创作项目，创建时必选分区，**默认自带第一个子贴**，子贴第一楼为正文
- **子贴**：主题下独立计数的一组回复串，楼层编号从 1 开始
- **楼中楼**：平级挂载在楼层下，不限制嵌套深度，所有条目平级
- **主题帖标签**：平台级（如 `#无限流`），跨主题帖搜索筛选
- **子贴标签**：主题帖内自由创建，用于该故事帖内部子贴分类

### 首期不引入

微服务 / Kubernetes / Kafka / Elasticsearch / GraphQL / 复杂实时聊天 / 自建邮件服务器 / 通用游戏规则引擎 / 敏感词过滤

---

## 2. 技术选型

| 层级 | 选型 | 原因 |
|------|------|------|
| 运行时 | Node.js 当前 LTS + TypeScript | 与 Web、Expo 客户端共享语言生态 |
| 后端框架 | NestJS + Fastify Adapter | NestJS 负责模块化、依赖注入、鉴权、Swagger |
| API 风格 | REST + OpenAPI | Web、移动端、后台共用 |
| 数据库 | PostgreSQL | 关系模型清晰 |
| ORM | Prisma | 类型安全、事务、自关联 |
| 缓存与队列 | Redis + BullMQ + `@nestjs/bullmq` | 异步任务 |
| 认证 | Passport JWT + Argon2 | 标准、安全 |
| 参数校验 | `class-validator` + `class-transformer` | 与 DTO/Swagger 集成 |
| 图片存储 | 雨云 S3 (cn-nb1.rains3.com) | 客户端直传 |
| 邮件 | 腾讯 SES + Nodemailer | 仅注册验证、找回密码 |
| 日志 | Pino + `nestjs-pino` | 结构化日志 |
| 错误监控 | Sentry | 集中收集线上异常 |
| 健康检查 | `@nestjs/terminus` | `/health` 供部署平台检查 |
| 限流 | `@nestjs/throttler` | 全局 + 接口级限流 |

---

## 3. 产品设计决策

### 3.1 可见性与访问

- 全部内容默认公开，未登录可浏览
- 子贴 `visibility: PUBLIC | MEMBERS`

### 3.2 参与模式

- 自由加入：任何人随时可在任何位置发言
- 玩家标记：纯功能意义（仅用于 `postingPolicy` 判断）
- 子贴管理权限：仅 OWNER / COLLABORATOR
- 协作者：自由邀请制，可管理子贴、标签、踢人
- 角色：`OWNER` / `COLLABORATOR` / `PARTICIPANT`（无 READER）

### 3.3 内容编辑与删除

- 自由编辑，不锁窗口
- 编辑显示：一天内 `X 分钟/小时前`，一年内 `月-日`，超过一年 `年-月-日`
- 软删除：内容从流中消失
- 子贴正文删除：二次确认连带删除整个子贴
- 回复长度：最多 10,000 字

### 3.4 用户系统

- 注册需邮箱验证后才能发帖（未验证可浏览）
- 头像：默认字母色块 + 可选上传（暂不审核）
- 用户主页：创建的主题（始终可见）+ 最近回复/玩家身份/收藏（可开关）
- 拉黑：双向阻止 — 不通知 + 不能在对方帖子里发言
- 邮件用途：仅注册验证和找回密码

### 3.5 通知与订阅

- **站内通知**（不走邮件）：新建子贴/新楼层→通知楼主协作者；@提及/被回复→通知相关用户
- **订阅**（仅玩家）：订阅"某用户在该主题帖下的全部回复"或"整个主题帖"

### 3.6 首页与发现

- 分区 Tab：演绎 / 国策 / RPG
- 排序：推荐（默认加权热度）/ 最新 / 活跃
- 标签筛选：`?tag=无限流`

### 3.7 草稿

- 每用户每子贴 **5 个草稿位**（slot 1-5）
- 自动保存：选空闲位持续更新
- 手动保存：显式选位

### 3.8 主题帖创建流程

1. 填写标题、正文、必选分区、可选标签
2. 事务内：创建 Thread → 首个 Subthread → 第一楼 Post → OWNER 成员

### 3.9 举报与管理

- 举报人工处理，无敏感词过滤

---

## 4. 数据模型

### 19 张表

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| `User` | 用户 | email, username, password(Argon2), nickname, avatar, bio, role, emailVerified, privacySettings |
| `Thread` | 主题帖 | title, category(DEDUCTION/NATION/RPG), status, ownerId |
| `ThreadMember` | 成员 | threadId, userId, role, playerMarked |
| `Subthread` | 子贴 | threadId, title, sortOrder, visibility, postingPolicy, lastPostAt |
| `SubthreadTagDef` | 子贴标签定义 | threadId, name, color |
| `SubthreadTag` | 子贴 ↔ 标签关联 | subthreadId, tagId |
| `Post` | 楼层/楼中楼 | threadId, subthreadId, authorId, floorNumber, parentPostId, replyToPostId, content, deletedAt |
| `PostMention` | @提及记录 | postId, mentionedUserId |
| `Draft` | 草稿 | userId, subthreadId, slot(1-5), content |
| `Notification` | 站内通知 | userId, type, content, referenceId, isRead |
| `TopicTag` | 主题帖标签（平台级） | name, color |
| `ThreadTopicTag` | 主题帖 ↔ 标签关联 | threadId, topicTagId |
| `Subscription` | 订阅 | userId, threadId, targetUserId?, type(THREAD/USER) |
| `UserBlock` | 拉黑 | blockerId, blockedId |
| `UserReadProgress` | 阅读进度 | userId, subthreadId, postId(精确到楼中楼) |
| `Report` | 举报 | reporterId, targetType, targetId, reason, status, handledBy |
| `AuditLog` | 审计日志 | adminId, action, targetType, targetId, detail, ip |
| `EmailVerification` | 邮箱验证 | userId, token(哈希), expiresAt |

### 楼层编号约束

- `(subthread_id, floor_number)` 唯一
- 递增且永不复用
- 发帖事务内 `MAX(floor_number) + 1`

---

## 5. API 规范

- Base URL: `/api/v1`
- 错误格式: `{ statusCode, message, timestamp, path }`
- 分页: cursor-based (`CursorPaginationDto`)
- Swagger 文档: `/api/docs` (仅 dev)
- DTO 校验: `class-validator`

### 完整 API 端点（已实现 50+）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/v1/health` | 健康检查 | 否 |
| POST | `/api/v1/auth/register` | 注册 | 否 |
| POST | `/api/v1/auth/login` | 登录 | 否 |
| POST | `/api/v1/auth/refresh` | 刷新 Token | 否 |
| GET | `/api/v1/users/me` | 当前用户 | 是 |
| PATCH | `/api/v1/users/me` | 修改资料 | 是 |
| GET | `/api/v1/users/:id` | 用户公开信息 | 否 |
| GET | `/api/v1/tags` | 搜索标签 | 否 |
| POST | `/api/v1/tags` | 创建标签 | 是 |
| GET | `/api/v1/threads` | 分区列表 | 否 |
| POST | `/api/v1/threads` | 创建主题帖 | 是 |
| GET | `/api/v1/threads/:id` | 主题帖详情 | 否 |
| PATCH | `/api/v1/threads/:id` | 修改 | 是 |
| DELETE | `/api/v1/threads/:id` | 软删除 | 是 |
| GET | `/api/v1/threads/:id/members` | 成员列表 | 否 |
| POST | `/api/v1/threads/:id/members/join` | 加入 | 是 |
| POST | `/api/v1/threads/:id/members` | 邀请 | 是 |
| PATCH | `/api/v1/threads/:id/members/:userId` | 角色/玩家 | 是 |
| DELETE | `/api/v1/threads/:id/members/:userId` | 踢出 | 是 |
| GET | `/api/v1/threads/:id/tags` | 主题帖标签 | 否 |
| POST | `/api/v1/threads/:id/tags` | 添加标签 | 是 |
| DELETE | `/api/v1/threads/:id/tags/:tagId` | 移除标签 | 是 |
| GET | `/api/v1/threads/:id/subthreads` | 子贴列表 | 否 |
| POST | `/api/v1/threads/:id/subthreads` | 创建子贴 | 是 |
| GET | `/api/v1/subthreads/:id` | 子贴详情 | 否 |
| PATCH | `/api/v1/subthreads/:id` | 修改 | 是 |
| DELETE | `/api/v1/subthreads/:id` | 删除 | 是 |
| GET | `/api/v1/subthreads/:id/tags` | 子贴标签 | 否 |
| POST | `/api/v1/subthreads/:id/tags` | 添加 | 是 |
| DELETE | `/api/v1/subthreads/:id/tags/:tagId` | 移除 | 是 |
| GET | `/api/v1/subthreads/:id/posts` | 楼层列表 | 否 |
| POST | `/api/v1/subthreads/:id/posts` | 发帖 | 是 |
| GET | `/api/v1/posts/:id` | 帖子详情 | 否 |
| GET | `/api/v1/posts/:id/replies` | 楼中楼列表 | 否 |
| PATCH | `/api/v1/posts/:id` | 编辑 | 是 |
| DELETE | `/api/v1/posts/:id` | 软删除 | 是 |
| GET | `/api/v1/drafts` | 草稿列表 | 是 |
| GET | `/api/v1/drafts/slots` | 槽位使用 | 是 |
| POST | `/api/v1/drafts` | 保存草稿 | 是 |
| GET | `/api/v1/drafts/:id` | 单条草稿 | 是 |
| PATCH | `/api/v1/drafts/:id` | 更新 | 是 |
| DELETE | `/api/v1/drafts/:id` | 删除 | 是 |
| GET | `/api/v1/notifications` | 通知列表 | 是 |
| GET | `/api/v1/notifications/unread` | 未读数 | 是 |
| PATCH | `/api/v1/notifications/:id/read` | 单条已读 | 是 |
| POST | `/api/v1/notifications/read-all` | 全部已读 | 是 |
| GET | `/api/v1/subscriptions` | 订阅列表 | 是 |
| POST | `/api/v1/subscriptions` | 创建订阅 | 是 |
| DELETE | `/api/v1/subscriptions/:id` | 取消 | 是 |
| GET | `/api/v1/reading-progress` | 阅读进度 | 是 |
| POST | `/api/v1/reading-progress` | 记录进度 | 是 |
| POST | `/api/v1/reports` | 提交举报 | 是 |
| GET | `/api/v1/reports` | 举报列表 | 是(ADMIN) |
| PATCH | `/api/v1/reports/:id/handle` | 处理举报 | 是(ADMIN) |
| POST | `/api/v1/media/upload-url` | 预签名上传 | 是 |
| GET | `/api/v1/admin` | 管理后台入口 | 否 |

---

## 6. 模块架构

```
src/
├── app.module.ts           # 根模块（全局模块 + 限流 Guard + BullMQ 连接）
├── main.ts                 # Fastify + Pino + Swagger + Sentry + 限流
├── config/                 # 环境变量
├── common/                 # 通用组件（异常过滤器、拦截器、分页、装饰器）
├── prisma/                 # Prisma 服务（全局）
├── health/                 # 健康检查
├── auth/                   # 认证（JWT、Argon2、限流）
├── users/                  # 用户资料
├── threads/                # 主题帖（CRUD + 事务创建）
│   ├── thread-members.*    # 成员管理
│   └── thread-tags.*       # 主题帖标签关联
├── subthreads/             # 子贴（CRUD + 排序 + 标签）
├── tags/                   # 主题帖标签（平台级）
├── posts/                  # 楼层与楼中楼
├── mentions/               # @提及解析
├── drafts/                 # 5 槽位草稿
├── notifications/          # 站内通知 + 未读数
├── subscriptions/          # 玩家订阅
├── reading-progress/       # 阅读进度
├── reports/                # 举报
├── media/                  # S3 预签名上传
├── jobs/                   # BullMQ 队列
│   ├── notification.producer.ts
│   └── notification.processor.ts
└── admin/                  # 管理后台 API
```

### 模块依赖规则

- Controller 禁止跨模块业务逻辑
- `Posts` 发帖后触发 `notification` 队列任务
- `Auth` JWT Guard 全局复用
- `Common` 导出装饰器、过滤器、分页 DTO

---

## 7. 异步任务 (BullMQ)

| 队列 | 任务 | 状态 |
|------|------|------|
| `notification` | reply、mention、new_floor、new_subthread | ✅ 已实现 |
| `email` | verify、reset-password | 待实现 |
| `media` | process-image (sharp) | 待实现 |
| `maintenance` | cleanup-drafts、cleanup-users | 待实现 |

---

## 8. 安全基线

- 密码 Argon2 哈希
- Access Token 15m + Refresh Token 7d
- 邮箱验证 Token 仅存哈希 + 过期
- 登录/注册/发帖/回复/上传限流（`@nestjs/throttler`）
- PostgreSQL/Redis 不暴露公网（docker-compose 127.0.0.1）
- S3 预签名上传 URL
- Markdown 服务端不做 HTML 渲染
- 敏感配置仅存于环境变量
- 软删除
- 审计日志（AuditLog）
- 上传限制：MIME 白名单、10MB

---

## 9. 已完成开发顺序

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | 项目骨架、Docker、Prisma、Health | ✅ |
| 2 | 认证（注册/登录/JWT/Argon2）、用户资料 | ✅ |
| 3 | 主题帖、成员、协作者、主题帖标签、推荐排序 | ✅ |
| 4 | 子贴 CRUD、排序、子贴标签、发帖权限 | ✅ |
| 5 | 楼层、楼中楼、楼层编号、编辑、软删除 | ✅ |
| 6 | 草稿 5 槽位、@提及、通知队列、订阅 | ✅ |
| 7 | 举报、管理后台 API、拉黑（双向阻止）、管理员脚本 | ✅ |
| 8 | 限流、Sentry、媒体预签名上传 | ✅ |
| 9 | Dockerfile、Caddy SSL、部署脚本、备份脚本 | ✅ |

**全部 9 个 Phase 完成。**

---

## 10. 部署

### 架构

```
Internet → Caddy(:443, 自动SSL) → API(:3000) → Postgres + Redis
```

### 部署命令

```bash
# 编辑域名
vim Caddyfile  # example.com → 你的域名

# 编辑生产配置
cp .env.example .env.prod
vim .env.prod    # 填入生产密钥

# 部署
bash scripts/deploy.sh

# 初始化管理员
docker compose -f docker-compose.prod.yml exec api npx tsx scripts/set-admin.ts admin@wenyouzhan.com

# 数据库备份
bash scripts/backup.sh
```

---

## 11. 开发指南

### 环境要求

| 工具 | 版本 |
|------|------|
| Node.js | >= 24 LTS (fnm) |
| pnpm | >= 9 |
| Docker | >= 27 |
| PostgreSQL | 17 (docker) |
| Redis | 7 (docker) |

### 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 启动 PostgreSQL + Redis |
| `docker compose down` | 停止 |
| `pnpm install` | 安装依赖 |
| `pnpm start:dev` | 开发服务器 (watch) |
| `pnpm build` | 生产构建 |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:migrate` | 数据库迁移 |
| `pnpm prisma:studio` | Prisma Studio |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `npx tsx scripts/set-admin.ts <email>` | 升级用户为 ADMIN |

### 测试策略

| 测试层 | 工具 | 覆盖 |
|--------|------|------|
| 编译 | `tsc -p tsconfig.json` | 0 错误 |
| 手动 curl | 各模块核心流程 | 全量 38 项 |
| 单元测试 | Jest (待完善) | Service 层 |
| e2e | supertest (待完善) | 每个模块 |

