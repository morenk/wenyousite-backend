# 温油站 — 前端文档中心

> 面向 Flutter（移动端）和 Next.js（Web 端）开发者的全模块前端对接指南。
> 本目录按"用户旅程"和"API 速查"双视角组织，适合直接交给 AI 阅读并生成页面代码。

## 阅读顺序（给 AI 的指令）

如果你是 AI 助手，请按以下顺序阅读：

1. **本文件**（README.md）—— 了解技术栈、全局约定、客户端生成方式。
2. **`user-journeys/`** —— 按用户旅程阅读对应流程，理解页面跳转、接口调用顺序、状态变化。
3. **`api-reference/`** —— 需要具体接口细节时查阅对应模块。
4. **`error-handling.md`** —— 统一错误码与前端提示策略。
5. **`flutter-web-tips.md`** —— 跨端差异提示。

## 技术栈

| 平台 | 技术选型 | 原因 |
|------|----------|------|
| 移动端 | Flutter | 已定，适合短平快互动 |
| Web 端 | Next.js 15 + TypeScript | 与 NestJS 后端语言一致，SEO 友好，长文排版和编辑器生态成熟 |

## API 客户端生成

后端已使用 `@nestjs/swagger` 生成 OpenAPI 文档：

```bash
# 1. 启动后端并导出 openapi.json
curl http://localhost:3000/api/docs-json > openapi.json
```

### Web 端（Next.js / TypeScript）

```bash
# 安装
npm i -D openapi-typescript
# 生成类型
npx openapi-typescript openapi.json -o src/api/types.ts

# 配合 openapi-fetch 使用
npm i openapi-fetch
```

```typescript
import createClient from 'openapi-fetch';
import type { paths } from '@/api/types';

const client = createClient<paths>({ baseUrl: '/api/v1' });

// 使用示例
const { data, error } = await client.GET('/threads', {
  params: { query: { limit: 20 } },
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### 移动端（Flutter）

```bash
# 使用 openapi_generator
flutter pub add openapi_generator
# 生成 Dart 客户端
flutter pub run openapi_generator:generate -i openapi.json -g dart-dio
```

## 全局约定

| 项目 | 值 |
|------|-----|
| API 前缀 | `/api/v1` |
| 开发环境 | `http://localhost:3000/api/v1` |
| 生产环境 | `https://wenyou.site/api/v1` |
| 认证头 | `Authorization: Bearer <accessToken>` |
| 响应格式 | `{ code, message, data, meta? }` |

## 核心用户旅程

| 旅程 | 说明 | 入口文件 |
|------|------|----------|
| 认证 | 注册、登录、Token 刷新、密码管理、会话管理 | `user-journeys/authentication.md` |
| 创建主题帖 | 从进入创建页到草稿创建、编辑、发布 | `user-journeys/create-thread.md` |
| 发布主题帖 | 发布校验、乐观锁、发布成功/失败处理 | `user-journeys/publish-thread.md` |
| 发帖与回复 | 在子贴下发帖、楼中楼回复、@提及 | `user-journeys/post-and-reply.md` |
| 用户资料/关注/拉黑 | 资料修改、关注、拉黑、隐私开关 | `user-journeys/profile-follow-block.md` |
| 通知 | 通知列表、未读数、已读、跳转 | `user-journeys/notifications.md` |
| 图片上传 | 预签名 URL、S3 直传、异步处理、状态轮询 | `user-journeys/image-upload.md` |

## 模块 API 速查

| 模块 | 文件 |
|------|------|
| 主题帖 | `api-reference/threads.md` |
| 子贴 | `api-reference/subthreads.md` |
| 草稿 | `api-reference/drafts.md` |
| 标签 | `api-reference/tags.md` |
| 媒体 | `api-reference/media.md` |
| 搜索 | `api-reference/search.md` |
| 收藏 | `api-reference/bookmarks.md` |
| 阅读进度 | `api-reference/reading-progress.md` |
| 订阅 | `api-reference/subscriptions.md` |

## 重要业务概念

### 1. 沙盒草稿帖 vs 全局草稿池

这是两个完全不同的东西，前端必须区分清楚：

- **沙盒草稿帖（Thread 级）**：`POST /threads` 创建，`published=false`。它就是一个完整的主题帖容器，只是还没对外发布。楼主可以在里面创建子贴、写楼层，最后发布。
- **全局草稿池（Draft 表）**：`POST /drafts` 保存，用户最多 5 条，纯文本缓存，**不与任何子贴绑定**。适合作为编辑器里的"浮动草稿"——比如用户临时切出去写另一条回复。

**前端常见误区**：不要把主题帖的创建流程等同于草稿池的使用。

### 2. 发布前后状态差异

| 状态 | 可见性 | 通知 | 搜索/列表 |
|------|--------|------|-----------|
| 草稿（published=false） | 仅 owner | 不发 | 不出现 |
| 已发布（published=true） | 按 visibility 公开或私密 | 通知粉丝、回放 @提及 | 出现在列表/搜索 |

## 与传统论坛的关键差异

- **主题帖本身不存正文**：正文在子贴下的 `Post` 里。列表卡片预览取的是默认子贴的首楼正文。
- **所有主题帖必须先创建草稿再发布**：不存在"直接发布"的接口。
- **子贴是发帖的最小容器**：任何 `Post` 都必须属于某个 `Subthread`。
- **楼层编号在子贴内独立**：每个子贴从 1 开始编号；楼中楼回复 `floorNumber = null`。
