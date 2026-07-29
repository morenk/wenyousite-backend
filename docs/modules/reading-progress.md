# 阅读进度

## 概述
阅读进度模块记录用户在每个子贴中的最后阅读位置（精确到楼层/楼中楼），提供新增回复计数、帖级聚合摘要，并在用户发帖时自动推进进度。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `UserReadProgress` | 用户阅读进度记录，每个用户每子贴最多一条（upsert） |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/reading-progress?subthreadId=` | `@AuthRead()` | 查询指定子贴的阅读进度，不传则查全部 |
| `GET` | `/reading-progress/new-replies?subthreadId=` | `@AuthRead()` | 查询自上次阅读后子贴新增回复数 |
| `POST` | `/reading-progress` | `@AuthRead()` | 手动更新阅读进度（subthreadId + postId） |

## 核心业务规则

- 每个用户在每个子贴仅保存一条记录，通过 `@@unique([userId, subthreadId])` 保证
- 使用 upsert 更新进度：存在则更新 `postId` 和 `updatedAt`，不存在则新建
- `newRepliesSince` 统计逻辑：
  - 从未读过：返回全部楼层数，`continueFrom: null`
  - 读过且记录了 `postId`：以最后阅读帖子的 `createdAt` 为时间锚点，不受进度更新时间影响
  - 读过但无 `postId`（仅进入过子贴）：以 `updatedAt` 为锚点
  - 返回 `continueFrom`（最后阅读的帖子信息）、`newReplies`（新增数）、`totalPosts`（总数）
- 发帖后自动推进阅读进度：调用 `PostsService.create()` 成功后，服务端自动调用 `readingProgressService.update()` 将该帖标记为已读
- `findAll` 自动过滤已软删除的子贴

## 设计决策

- **时间锚点用 post.createdAt 而非 progress.updatedAt**：后者每次 update 都会前移，导致帖子列表中部的回复被永久跳过。锚定到帖子的创建时间，即使用户反复调用保存进度也不受影响
- **发帖自动推进**：用户发帖本身证明已读到此处，无需客户端额外调用
- 返回 `continueFrom`（最后阅读帖子位置）使客户端可以渲染"继续阅读"跳转 UI
