# 温油站后端 - 开发指南

## 环境要求

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

## 环境变量

复制 `.env.example` 为 `.env`，按需修改。

## 项目结构

```
src/
├── config/         # 环境变量校验与配置
├── common/         # 通用模块 (拦截器, 过滤器, DTO)
├── prisma/         # Prisma 数据库服务
├── health/         # 健康检查
├── auth/           # 认证与授权
├── users/          # 用户模块
├── threads/        # 主题/故事帖
├── subthreads/     # 子贴/分区
├── tags/           # 标签
├── posts/          # 楼层与回复
├── mentions/       # @提及
├── drafts/         # 草稿
├── media/          # 文件上传
├── notifications/  # 通知
├── reports/        # 举报
├── moderation/     # 审核
├── jobs/           # 异步任务队列
├── admin/          # 管理后台
```

## API 规范

- Base URL: `/api/v1`
- 错误格式: `{ statusCode, message, timestamp, path }`
- 分页: cursor-based
- OpenAPI 文档: `/api/docs` (dev only)
