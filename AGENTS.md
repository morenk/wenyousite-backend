# 温油站后端 — AI 辅助编程上下文

## 项目概述

温油站是一个文字接力、角色扮演、国策等自由玩法的共同创作论坛。
NestJS + Fastify + PostgreSQL + Prisma + Redis + BullMQ，模块化单体架构。

## 技术栈

| 分类 | 选型 | 用途 |
|------|------|------|
| 运行时 | Node.js 24 LTS + TypeScript | — |
| 框架 | NestJS + Fastify | Fastify 性能优于 Express |
| 数据库 | PostgreSQL 17 + Prisma ORM | 22 张表，8 个枚举，类型安全 |
| 缓存/队列 | Redis 7 + BullMQ | 通知队列 (notification) + 图片处理队列 (image) |
| 认证 | Passport JWT + Argon2 | 双 Token (access 15m / refresh 7d) |
| 校验 | class-validator + class-transformer | DTO 自动校验 |
| 日志 | nestjs-pino + pino-pretty + pino-roll | 结构化日志，dev 彩色控制台，prod JSON + 可选日滚动文件 |
| 错误监控 | @sentry/nestjs + @sentry/node | 有 DSN 时启用 |
| 限流 | @nestjs/throttler | 全局 + auth 端点加强 |
| 事件 | @nestjs/event-emitter | 发帖后事件解耦 mentions/notifications |
| 定时 | @nestjs/schedule | 每天凌晨 4 点清理过期 token 和僵尸用户 |
| 安全 | helmet | HTTP 安全头 |
| 图片 | @aws-sdk/client-s3 + sharp | 预签名直传 + 异步缩略图（300x300 + 800px） |
| 邮件 | nodemailer | 阿里云邮件推送 DirectMail SMTP（smtpdm.aliyun.com） |
| 文档 | @nestjs/swagger | /api/docs (仅 dev) |
| 健康检查 | @nestjs/terminus | /api/v1/health |
| 测试 | Jest + ts-jest | 16 套件 255 用例 |

## 项目结构

```
src/
├── main.ts                    # 入口: Fastify + Pino + Swagger + Sentry + Helmet
├── app.module.ts              # 根模块: 全局限流 + EventEmitter + 定时任务 + BullMQ
├── app.controller.ts          # 根控制器: / 路由
├── config/                    # configuration.ts + env.validation.ts
├── common/                    # 全局复用
│   ├── decorators/public.decorator.ts    # @Public() 跳过 JWT
│   ├── guards/verified.guard.ts         # 邮箱验证守卫
│   ├── guards/block.guard.ts            # 拉黑拦截守卫
│   ├── services/thread-access.service.ts # 主题帖访问权限 + 管理权限校验
│   ├── filters/all-exceptions.filter.ts # 统一异常格式
│   ├── interceptors/response.interceptor.ts
│   ├── prisma-helpers.ts                # 软删除/计数查询共享 helper
│   └── dto/pagination.dto.ts            # cursor 分页
├── prisma/                    # PrismaService (全局提供)
├── auth/                      # 注册/登录/刷新/验证/改密码/找回密码
│   ├── decorators/auth.decorator.ts  # @Auth() 和 @AuthRead()
│   ├── strategies/jwt.strategy.ts
│   └── guards/jwt-auth.guard.ts
├── users/                     # 资料 + 关注 + 拉黑
│   ├── users.controller.ts    # me, search, :id
│   └── users-follow.controller.ts  # follow, block
├── threads/                   # 主题帖(事务创建/私密帖/置顶) + 成员(角色/玩家) + 邀请链接 + 标签
├── subthreads/                # 子贴 + 软删除 + 发帖权限(PARTICIPANTS/COLLABORATORS/PLAYERS)
├── tags/                      # 平台级 TopicTag
├── posts/                     # 楼层 + 楼中楼(平级) + 编辑 + 软删除 + 点赞
├── mentions/                  # @提及解析 + 权限规则
├── drafts/                    # 用户级全局 5 槽位草稿池
├── notifications/             # 站内通知(列表/未读数/已读) — 含结构化导航字段
├── subscriptions/             # 订阅(整帖 THREAD / 某用户 USER) + 通知投递
├── reading-progress/          # 阅读进度 + 新增回复数
├── reports/                   # 举报（已搁置，待后期重构）
├── search/                    # 全文搜索 (PostgreSQL ILIKE)
├── email/                     # SMTP 邮件服务
├── media/                     # S3 预签名上传 + upload-done 确认 + 异步 sharp 缩略图
├── jobs/                      # BullMQ: notification 队列 + image 队列 + 事件监听 + 定时清理
├── admin/                     # 管理后台 API
└── health/                    # 健康检查端点
scripts/
├── set-admin.ts               # 管理员初始化
├── deploy.sh                  # 一键部署
└── backup.sh                  # 数据库备份
```

## 守卫架构

| 装饰器 | 守卫链 | 用途 |
|--------|--------|------|
| `@Public()` | 无 | 公开端点 (GET /threads 列表) |
| `@AuthRead()` | JwtAuthGuard | 需登录的读/写操作（当前所有写端点均使用此级别） |
| `@Auth()` | JwtAuthGuard + VerifiedGuard | 需登录+邮箱验证（仅关注/拉黑端点使用） |

- 全局守卫 (app.module.ts APP_GUARD): ThrottlerGuard（限流）、BlockGuard（拉黑拦截）

## Prisma 枚举速查

| 枚举 | 值 | 用途 |
|------|----|------|
| `ThreadCategory` | DEDUCTION, NATION, RPG | 主题帖分区 |
| `ThreadStatus` | RECRUITING, CLOSED, FINISHED | 主题帖生命周期 |
| `ThreadVisibility` | PUBLIC, PRIVATE | 私密帖控制 |
| `UserRole` | USER, ADMIN, SUPER_ADMIN | 用户权限等级 |
| `MemberRole` | OWNER, COLLABORATOR, PARTICIPANT | 帖内成员角色 |
| `PostingPolicy` | PARTICIPANTS, COLLABORATORS, PLAYERS | 子贴发帖权限 |
| `NotificationType` | reply, mention, new_floor, thread_created, follow | 通知类型 |
| `SubscriptionType` | THREAD, USER | 订阅粒度 |

## 核心设计决策

1. **内容格式**：服务端不渲染 Markdown，仅存取纯字符串。图文混排由客户端在 Markdown 中嵌入 `![](url)` 实现。
2. **@提及权限**：1) 已关注→可@ / 2) 同帖玩家间可@ / 3) 玩家可@楼主 / 4) 楼主可@任何人 / 5) @自己无通知。
3. **拉黑**：双向阻止 — 不能发帖 + 不发通知。拉黑者的帖子对被拉黑者不可见。
4. **楼中楼**：平级挂载，无嵌套深度限制，所有回复共享 `parentPostId`。回复目标通过 `replyToPostId` 追踪。
5. **楼层编号**：事务内 `MAX+1`，永不复用。楼中楼帖子 `floorNumber = null`。
6. **草稿**：用户级全局 5 槽位池，不与子贴绑定。满时返回错误，不自动覆盖。编辑器全局浮动，不绑定子贴。
7. **通知投递**：站内通知走 BullMQ `notification` 队列异步投递。6 类通知类型 (reply / mention / new_floor / subthread_created / thread_created / follow)。邮件仅用于注册验证和密码重置。
8. **私密帖**：`visibility=PRIVATE`，不在列表/搜索中显示，仅成员可访问。加入方式仅限邀请链接 (`ThreadInvite`)，踢出仅取消玩家标记。
9. **订阅推送**：用户可订阅整帖 (THREAD) 或帖内某用户 (USER)。发帖时通过 `PostEventsListener` + `SubscriptionsService.findSubscribers()` 合并订阅者到通知列表。
10. **图片上传**：客户端通过预签名 URL 直传 S3，完成后调 `upload-done` 确认。服务端写入 Media 表，入队 `image` 队列用 sharp 生成 300×300 缩略图 + 800px 中图 (WebP)。
11. **软删除可访问性**：Thread/Subthread/Post 均采用软删除 (`deletedAt`)。所有面向用户的查询必须在 WHERE 子句中包含 `deletedAt: null`。`src/common/prisma-helpers.ts` 提供 `notDeleted` 常量及 `countNonDeletedPosts()`、`includeSubthreads()` 等组合 helper 消除重复。
12. **访问权限复用**：`ThreadAccessService` 统一定义 `assertAccessible()`（软删除/未发布/私密帖访问校验）和 `assertCanManage()`（OWNER/COLLABORATOR 管理权限校验），供 `ThreadsService`、`SubthreadsService`、`ThreadMembersService` 及标签控制器共用。

## 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 启动 PG + Redis |
| `pnpm install` | 安装依赖 |
| `pnpm build` | 编译 |
| `pnpm start:dev` | 开发服务器 |
| `pnpm test` | 单元测试 (16 套件 255 用例) |
| `pnpm prisma:studio` | 数据库 GUI |
| `npx tsx scripts/set-admin.ts <email>` | 升级管理员 |
| `bash scripts/deploy.sh` | 生产部署 |
| `bash scripts/backup.sh` | 数据库备份 |

## 部署

```bash
echo "DOMAIN=xxx.com" > .env
bash scripts/deploy.sh
```

### 本地 VPS 生产模式运行（改代码需重启）

VPS 上手动迭代用**生产模式**（`node dist/main`），比 `start:dev`（watch + ts 编译）省内存、RSS 稳定不涨。**生产模式没有热更新**：改代码必须 `pnpm build` 后重启进程。

```bash
cd /root/wenyousite/wenyousite-backend
pnpm build
kill $(ss -tlnp | grep :3000 | grep -oP 'pid=\K[0-9]+')
setsid nohup env NODE_ENV=production node dist/main </dev/null \
  > /tmp/opencode/wenyousite-backend.log 2>&1 &
```

- 首次/依赖变更后先 `npx prisma generate`；`npx prisma migrate deploy` 应用未执行迁移（幂等）
- 日志：`/tmp/opencode/wenyousite-backend.log`
- 前端对应的生产模式迭代流程见前端 `AGENTS.md` 第 11 节

## 代码规范

### 中文注释（强制）

| 元素 | 要求 | 示例 |
|------|------|------|
| 每个 `.ts` 文件头部 | 文件用途说明（1 行） | `/** 用户服务：查询、更新、关注、拉黑 */` |
| 每个 `class` | 类职责说明（1-2 行） | `/** 认证服务：注册、登录、Token 刷新 */` |
| 每个 `public` 方法 | 功能说明（1 行） | `/** 注册新用户 */` |
| 关键逻辑段 | 行内注释 | `// 过滤掉被拉黑的用户，不发送通知` |
| DTO 字段 | `@ApiProperty({ description: '中文描述' })` | — |
| 模块文件 | 模块用途说明 | `/** 主题帖模块：CRUD、成员管理 */` |

### 守卫使用规范

```
@Public()       — 公开端点，无需认证
@AuthRead()     — 需登录（JWT），不校验邮箱
@Auth()         — 需登录 + 邮箱验证
```

## Git 提交规范

### 提交粒度

每次提交对应一个**可独立理解、独立回滚**的逻辑单元：

| 达到以下任一条件即提交 | 示例 |
|---|---|
| 完成一个完整功能特性 | 新增重发验证邮件端点 |
| 完成一个 bug 修复（含原因和验证） | 修复 refresh token 异常消息被吞没 |
| 完成一个模块的重构 | 认证模块 DTO 参数规范化 |
| 完成一个数据库迁移 | Schema 变更 + 迁移文件 + 服务层适配 |
| 完成一批文档更新 | 某模块 .md 同步更新 |

**必须**遵守：
- 每次提交的代码改动，必须同步更新对应模块的 `docs/modules/<module>.md` 文档：端点表、业务规则、请求/响应格式、前端指引等章节如有变更，一并在同一个提交中反映
- 如果改动涉及 API 端点表，同步更新 `docs/api-endpoints.md`
- 如果涉及数据库 Schema，确保 `docs/data-model.md` 与 `prisma/schema.prisma` 一致（迁移文件已由 Prisma 自动管理）

**禁止**的做法：
- 攒一堆不相关改动做一次大提交
- 提交包含未完成或未编译的代码
- 把 Schema 迁移和业务逻辑拆分到不同提交（迁移和适配代码必须在同一个提交里）

### 提交信息格式

```
<type>: <中文简述>

- 要点 1
- 要点 2
```

| Type | 用途 |
|------|------|
| `feat` | 新功能、新端点 |
| `fix` | bug 修复 |
| `refactor` | 重构（不改变外部行为） |
| `docs` | 纯文档更新 |
| `chore` | 依赖、配置、脚本等杂项 |

### 提交前检查

- [ ] `npx tsc --noEmit` 编译通过
- [ ] `pnpm test` 全部通过
- [ ] `git diff --cached` 确认包含所有相关文件（迁移 + 代码 + 文档）
- [ ] 确认没有混入无关文件或 secrets

## 详细文档

完整 API 端点、数据模型、通知投递、图片上传等详见 [`docs/`](./docs/README.md)。
