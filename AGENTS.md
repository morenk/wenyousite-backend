# 温油站后端 — 项目上下文

## 项目概述

温油站是一个文字接力、角色扮演、国策等自由玩法的共同创作社区后端。
NestJS + Fastify + PostgreSQL + Prisma + Redis + BullMQ，模块化单体架构。

## 技术栈

| 分类 | 选型 | 用途 |
|------|------|------|
| 运行时 | Node.js 24 LTS + TypeScript | — |
| 框架 | NestJS + Fastify | Fastify 性能优于 Express |
| 数据库 | PostgreSQL 17 + Prisma ORM | 19 张表，类型安全 |
| 缓存/队列 | Redis 7 + BullMQ (@nestjs/bullmq) | 通知、图片异步处理 |
| 认证 | Passport JWT + Argon2 | 双 Token (access 15m / refresh 7d) |
| 校验 | class-validator + class-transformer | DTO 自动校验 |
| 日志 | nestjs-pino + pino-pretty | 结构化日志，dev 彩色输出 |
| 错误监控 | @sentry/nestjs + @sentry/node | 有 DSN 时启用 |
| 限流 | @nestjs/throttler | 全局 + auth 端点加强 |
| 事件 | @nestjs/event-emitter | 模块间解耦 |
| 定时 | @nestjs/schedule | 清理过期数据 |
| 安全 | helmet | HTTP 安全头 |
| 图片 | @aws-sdk/client-s3 + sharp | 预签名上传 + 压缩缩略图 |
| 邮件 | nodemailer | 等待 SES 配置 |
| 文档 | @nestjs/swagger | /api/docs (仅 dev) |
| 健康检查 | @nestjs/terminus | /api/v1/health |
| 测试 | Jest + ts-jest | 11 套件 66 用例 |

## 项目结构

```
src/
├── main.ts                    # 入口: Fastify + Pino + Swagger + Sentry + Helmet
├── app.module.ts              # 根模块: 全局限流 + EventEmitter + 定时任务 + BullMQ
├── config/                    # configuration.ts + env.validation.ts
├── common/                    # 全局复用
│   ├── decorators/public.decorator.ts    # @Public() 跳过 JWT
│   ├── guards/verified.guard.ts         # 邮箱验证守卫
│   ├── guards/block.guard.ts            # 拉黑拦截守卫
│   ├── filters/all-exceptions.filter.ts # 统一异常格式
│   ├── interceptors/response.interceptor.ts
│   └── dto/pagination.dto.ts            # cursor 分页
├── prisma/                    # PrismaService (全局)
├── auth/                      # 注册/登录/刷新/验证/改密码
│   ├── decorators/auth.decorator.ts  # @Auth() = JWT+邮箱  @AuthRead() = 仅JWT
│   ├── strategies/jwt.strategy.ts
│   └── guards/jwt-auth.guard.ts
├── users/                     # 资料 + 关注 + 拉黑 + 搜索
│   ├── users.controller.ts    # me, search, :id
│   └── users-follow.controller.ts  # follow, block
├── threads/                   # 主题帖(事务创建) + 成员 + 玩家 + 标签关联
├── subthreads/                # 子贴 + 排序 + 子贴标签
├── tags/                      # 平台级 TopicTag
├── posts/                     # 楼层(floorNumber 递增) + 楼中楼(平级) + 编辑 + 软删除
├── mentions/                  # @提及解析 + 权限规则
├── drafts/                    # 5槽位草稿
├── notifications/             # 站内通知(列表/未读数/已读)
├── subscriptions/             # 玩家订阅(整帖/某用户)
├── reading-progress/          # 阅读进度 + 继续阅读计数
├── reports/                   # 举报提交 + 管理员处理
├── media/                     # 图片预签名上传
├── jobs/                      # BullMQ producer + processor
└── admin/                     # 管理后台 API
scripts/
├── set-admin.ts               # 管理员初始化
├── deploy.sh                  # 一键部署
└── backup.sh                  # 数据库备份
```

## 守卫架构

项目用三层装饰器控制访问：

| 装饰器 | 守卫链 | 用途 |
|--------|--------|------|
| `@Public()` | 无 | 公开端点 (GET /threads 等) |
| `@AuthRead()` | JwtAuthGuard | 需登录的读操作 (GET /notifications 等) |
| `@Auth()` | JwtAuthGuard + VerifiedGuard | 需登录+验证的写操作 (POST /posts 等) |

全局守卫 (app.module.ts APP_GUARD):
- ThrottlerGuard — 限流
- BlockGuard — 拉黑拦截(被拉黑者无法在对方帖内发帖)

## API 端点 (完整)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | /health | 无 | 健康检查 |
| POST | /auth/register | 无 | 注册 |
| POST | /auth/login | 无 | 登录 |
| POST | /auth/refresh | 无 | 刷新 Token |
| POST | /auth/verify-email | 无 | 邮箱验证 |
| POST | /auth/change-password | AuthRead | 改密码 |
| GET | /users/me | AuthRead | 当前用户 |
| PATCH | /users/me | Auth | 修改资料 |
| GET | /users/search | AuthRead | 搜索用户 |
| GET | /users/:id | Public | 公开信息 |
| POST | /users/follow/:id | Auth | 关注 |
| DELETE | /users/follow/:id | Auth | 取消关注 |
| GET | /users/following | AuthRead | 关注列表 |
| GET | /users/followers | AuthRead | 粉丝列表 |
| POST | /users/me/block/:id | Auth | 拉黑 |
| DELETE | /users/me/block/:id | Auth | 取消拉黑 |
| GET | /users/me/blocks | AuthRead | 黑名单 |
| GET | /tags | Public | 搜索标签 |
| POST | /tags | Auth | 创建标签 |
| GET | /threads | Public | 分区列表 |
| POST | /threads | Auth | 创建主题帖 |
| GET | /threads/:id | Public | 详情 |
| PATCH | /threads/:id | Auth | 修改 |
| DELETE | /threads/:id | Auth | 软删除 |
| GET | /threads/:id/members | Public | 成员列表 |
| POST | /threads/:id/members/join | Auth | 加入 |
| POST | /threads/:id/members | Auth | 邀请 |
| PATCH | /threads/:id/members/:userId | Auth | 角色/玩家 |
| DELETE | /threads/:id/members/:userId | Auth | 踢出 |
| GET | /threads/:id/tags | Public | 标签列表 |
| POST | /threads/:id/tags | Auth | 添加标签 |
| DELETE | /threads/:id/tags/:tagId | Auth | 移除标签 |
| GET | /threads/:id/subthreads | Public | 子贴列表 |
| POST | /threads/:id/subthreads | Auth | 创建子贴 |
| GET | /subthreads/:id | Public | 子贴详情 |
| PATCH | /subthreads/:id | Auth | 修改 |
| DELETE | /subthreads/:id | Auth | 删除 |
| GET | /subthreads/:id/tags | Public | 子贴标签 |
| POST | /subthreads/:id/tags | Auth | 添加 |
| DELETE | /subthreads/:id/tags/:tagId | Auth | 移除 |
| GET | /subthreads/:id/posts | Public | 楼层列表 |
| POST | /subthreads/:id/posts | Auth | 发帖 |
| GET | /posts/:id | Public | 帖子详情 |
| GET | /posts/:id/replies | Public | 楼中楼 |
| PATCH | /posts/:id | Auth | 编辑 |
| DELETE | /posts/:id | Auth | 软删除 |
| GET | /drafts | AuthRead | 草稿列表 |
| GET | /drafts/slots | AuthRead | 槽位使用 |
| POST | /drafts | Auth | 保存草稿 |
| PATCH | /drafts/:id | Auth | 更新 |
| DELETE | /drafts/:id | Auth | 删除 |
| GET | /notifications | AuthRead | 通知列表 |
| GET | /notifications/unread | AuthRead | 未读数 |
| PATCH | /notifications/:id/read | AuthRead | 单条已读 |
| POST | /notifications/read-all | AuthRead | 全部已读 |
| GET | /subscriptions | AuthRead | 订阅列表 |
| POST | /subscriptions | Auth | 创建 |
| DELETE | /subscriptions/:id | Auth | 取消 |
| GET | /reading-progress | AuthRead | 阅读进度 |
| GET | /reading-progress/new-replies | AuthRead | 新增回复数 |
| POST | /reading-progress | AuthRead | 记录进度 |
| POST | /reports | AuthRead | 提交举报 |
| GET | /reports | AuthRead | 管理员列表 |
| PATCH | /reports/:id/handle | AuthRead | 管理员处理 |
| POST | /media/upload-url | AuthRead | 预签名上传 |
| GET | /admin | Public | 管理后台入口 |

## 核心设计决策

- **内容**：服务端不渲染 Markdown，仅存取纯字符串。BBCode 拓展 Markdown 由客户端解析
- **@提及权限**：1) 已关注→可@  2) 同帖玩家间可@  3) 玩家可@楼主  4) 楼主可@任何人  5) @自己无通知
- **拉黑**：双向阻止——不能发帖 + 不发通知
- **楼中楼**：平级挂载，无嵌套深度限制，所有回复共享 parentPostId
- **楼层编号**：事务内 MAX+1，永不复用
- **草稿**：每用户每子贴 5 槽位，自动选空闲位，满时覆盖最旧
- **通知**：站内通知走 BullMQ 异步投递，邮件仅用于注册验证和改密码
- **邮箱验证**：注册生成 token + dev 环境打印到控制台 + @Auth() 守卫拦截未验证用户写操作

## 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 启动 PG + Redis |
| `pnpm install` | 安装依赖 |
| `pnpm build` | 编译 `tsc -p tsconfig.json` |
| `pnpm start:dev` | 开发服务器 |
| `pnpm test` | 单元测试 11 套件 66 用例 |
| `pnpm prisma:studio` | 数据库 GUI |
| `npx tsx scripts/set-admin.ts <email>` | 升级管理员 |
| `bash scripts/deploy.sh` | 生产部署 |
| `bash scripts/backup.sh` | 数据库备份 |

## 部署

```bash
# Caddyfile 改为你的域名，.env 填入密钥
echo "DOMAIN=xxx.com" > .env
bash scripts/deploy.sh
```

## 待完善

- 邮箱验证：当前 token 打印到控制台，SES 配好后改邮件投递
- `@nestjs/event-emitter` 已安装，Posts 发帖后可用事件解耦 mentions/notifications
- `@nestjs/schedule` 已安装，可加定期清理过期草稿/未验证用户
- sharp 已安装，可在媒体队列中实现图片压缩缩略图
- 用户隐私开关字段已定义但未在 GET user 时应用
- 找回密码流程
