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
| 测试 | Jest + ts-jest | 单元、服务和控制器测试；数量由测试运行器统计，不在文档手写 |

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
9. **订阅推送**：普通用户可订阅官方更新 (THREAD) 或帖内普通已标记玩家 (USER)；楼主/协作者自动接收全部帖子动态且不能创建冗余订阅。发帖时通过 `PostEventsListener` + `SubscriptionsService.findSubscribers()` 按发帖时角色快照合并通知。
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
| `pnpm lint` | ESLint 只检查，不改文件 |
| `pnpm lint:fix` | ESLint 自动修复 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | Jest 单元/服务/控制器测试 |
| `pnpm test:e2e` | 本机测试环境 API E2E（需 `API_E2E_ENV=test`） |
| `pnpm check` | 唯一质量门禁：lint + typecheck + test + build |
| `pnpm check:full` | 发布前完整门禁：check + API E2E |
| `pnpm prisma:studio` | 数据库 GUI |
| `npx tsx scripts/set-admin.ts <email>` | 升级管理员 |
| `bash scripts/deploy.sh` | 生产部署 |
| `bash scripts/backup.sh` | 数据库备份 |

当前 ESLint 历史基线为 158 个 warning，`pnpm lint` 通过 `--max-warnings 158` 执行债务棘轮：新改动不得增加 warning；清理后应同步下调该数字，最终降为 0。

## 部署

```bash
cp .env.example .env.prod
# 编辑 .env.prod，填入生产配置
bash scripts/deploy.sh
```

### 本地 VPS 生产模式运行（改代码需重启）

VPS 上手动迭代用**生产模式**（`node dist/main`），比 `start:dev`（watch + ts 编译）省内存、RSS 稳定不涨。**生产模式没有热更新**：改代码必须重新构建后重启进程。完整发布优先使用 `scripts/deploy.sh`；下方仅适用于不含 Schema 变更的单服务手动重启。

生产部署与普通代码提交解耦。只有用户明确要求发布，或当前任务本身就是部署时，才允许执行生产迁移、重启或外部状态变更。一个发布批次可以包含多个原子提交，但只部署和验证一次；纯文档变更不重启服务。

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

### 数据库迁移与发布兼容

- Schema 变更默认采用 **expand → migrate/backfill → contract**：先增加兼容字段/表并双读写，再迁移数据和客户端，最后在后续发布移除旧结构。
- 禁止在同一发布中直接删除仍可能被上一版本前后端读取的字段、枚举值或索引。
- 回填脚本必须幂等、可重入、可观察进度，并在模块文档写明预估数据量、锁表风险和失败恢复方式。
- 发布前执行备份确认、`prisma migrate status`、`pnpm check`；迁移后再切换依赖新结构的应用版本。部署脚本不得让新代码在旧 Schema 上运行。
- Prisma 生产迁移原则上前滚修复；确需应用回滚时，必须确认数据可逆并记录恢复步骤。
- 发布后验证数据库、Redis、队列以及本次改动涉及的关键 API，并观察日志；持续 5xx、健康检查或关键路径失败时停止发布并回到上一已验证版本。

## 代码规范

### 注释规范

| 元素 | 要求 | 示例 |
|------|------|------|
| 文件/class | 仅职责无法从路径和名称判断时说明 | `/** 认证服务：注册、登录、Token 刷新 */` |
| public 方法 | 仅存在权限、副作用、事务或兼容约束时说明 | `/** 注册用户并在同一事务创建初始会话 */` |
| 关键逻辑段 | 解释原因、约束和不变量，不复述代码 | `// 拉黑双向生效，因此查询和通知都必须过滤` |
| DTO 字段 | `@ApiProperty({ description: '中文描述' })` | — |

不要求为机械 getter、显然的 CRUD 或框架样板补叙述性注释。公共 API 的 Swagger 描述、复杂权限规则和数据迁移说明仍为强制项。

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
- 一个提交按完整行为划分，可以同时包含 DTO、服务、控制器、迁移、测试和文档；不得按文件类型机械拆分
- 公共 API、业务规则、权限、数据模型、架构或运维行为变化时，必须同步更新对应 `docs/modules/<module>.md`
- 纯内部重构且外部行为不变时不强制制造文档改动，但提交说明必须写清验证范围
- 如果改动涉及 API 端点表，同步更新 `docs/api-endpoints.md`
- 如果涉及数据库 Schema，确保 `docs/data-model.md` 与 `prisma/schema.prisma` 一致（迁移文件已由 Prisma 自动管理）

**禁止**的做法：
- 攒一堆不相关改动做一次大提交
- 提交包含未完成或未编译的代码
- 提交只含迁移却没有使当前版本继续可运行的适配代码
- 把前后兼容需要分阶段发布的迁移强行压进一次部署

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

- [ ] `pnpm check` 通过
- [ ] bug 修复包含能复现旧问题的回归测试
- [ ] API/权限/迁移/队列等高风险变更完成相应集成或 E2E 验证
- [ ] `git diff --cached` 确认包含所有相关文件（迁移 + 代码 + 文档）
- [ ] 确认没有混入无关文件或 secrets

## 迭代流程（Contract-First + Risk-Based Testing）

### 阶段一：范围与风险

1. 写清目标、非目标、验收标准和受影响模块；小型内部修复可更新现有模块文档，不强制新建文档。
2. 标记认证/权限、数据写入、API 契约、数据库迁移、Redis/队列、上传、定时任务和生产配置风险。
3. 按完整行为拆分切片，每个切片应可验证、可回滚，并保持仓库可编译。
4. API 变更先更新 DTO 与 Swagger，明确是向后兼容新增还是破坏性变更。

### 阶段二：实现与验证

1. bug 先写回归测试；权限、事务、幂等、并发、队列重试和迁移逻辑优先测试先行。
2. 实现时复用守卫、`ThreadAccessService`、Prisma helpers、统一异常和响应 envelope，避免模块自行复制规则。
3. 公共行为变化同步模块文档、API 端点表和数据模型；运行时样例不得替代 Swagger 契约。
4. 每个行为切片执行相关测试，迭代完成统一执行 `pnpm check`。
5. 需要发布时，再执行迁移审查、`pnpm check:full` 或等价 API 烟雾测试、部署和观察。

### 测试映射

| 变更类型 | 最低验证要求 |
|----------|--------------|
| bug 修复 | 能复现旧问题的回归测试 |
| DTO/参数校验 | 正常、边界、错误输入测试 |
| Service 业务规则 | 成功、拒绝、资源不存在和事务失败测试 |
| Controller/API | Guard、HTTP 状态、响应 envelope 和错误码测试 |
| 权限/私密/拉黑 | 允许与拒绝矩阵，防止越权和信息泄露 |
| 队列/事件 | 重试、幂等、重复投递和依赖失败恢复测试 |
| 数据库迁移 | migration SQL 审查、真实 PostgreSQL 验证、回填幂等性 |
| 跨端核心旅程 | 本机测试环境 API E2E；禁止连接生产环境 |

### 跨端契约与部署顺序

- OpenAPI 是 Web 与 Flutter 的结构契约唯一事实源；真实响应快照只用于发现实现偏差。
- 新字段优先可选并提供兼容默认值，通常先部署后端，再部署客户端。
- 重命名或删除采用“新增 → 客户端迁移 → 移除旧项”的分阶段流程。
- 前后端分仓提交时，在模块文档记录对应 commit SHA 或发布批次标识。
- 破坏性变更必须写明兼容窗口、部署顺序和回滚方案。

### Definition of Done

- 验收标准满足，无已知 P0/P1 缺陷。
- `pnpm check` 通过；高风险或发布任务完成相应集成/E2E 验证。
- Swagger、DTO、运行时响应和客户端生成类型一致。
- 公共行为文档已同步，提交中没有 secrets、测试账号凭据或临时调试代码。
- 若发布：迁移、备份、部署顺序、健康检查、关键路径验证、日志观察和回滚点均已确认。

## 详细文档

完整 API 端点、数据模型、通知投递、图片上传等详见 [`docs/`](./docs/README.md)。
