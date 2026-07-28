# 阅读进度

## 概述
阅读进度模块记录用户在每个子贴中的最后阅读位置（精确到楼层/楼中楼），并提供自上次阅读后的新增回复计数。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `UserReadProgress` | 用户阅读进度记录，每个用户每子贴最多一条（upsert） |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/reading-progress?subthreadId=` | `@AuthRead()` | 查询指定子贴的阅读进度，不传则查全部 |
| `GET` | `/reading-progress/new-replies?subthreadId=` | `@AuthRead()` | 查询自上次阅读后子贴新增回复数 |
| `POST` | `/reading-progress` | `@AuthRead()` | 更新阅读进度（subthreadId + postId） |

## 核心业务规则

- 每个用户在每个子贴仅保存一条记录，通过 `@@unique([userId, subthreadId])` 保证
- 使用 upsert 更新进度：存在则更新 `postId` 和 `updatedAt`，不存在则新建
- `newRepliesSince` 统计逻辑：
  - 从未读过：返回全部楼层数，`continueFrom: null`
  - 读过：统计 `createdAt > lastReadTime` 且 `deletedAt: null` 的帖子数
  - 返回 `continueFrom`（最后阅读的帖子信息）、`newReplies`（新增数）、`totalPosts`（总数）

## 设计决策

- 以 `updatedAt` 而非 `createdAt` 作为阅读时间基准，因为同一条记录可能多次更新而创建时间不变
- 返回 `continueFrom`（最后阅读帖子位置）而非简单的新增计数，使客户端可以渲染"继续阅读"跳转 UI
- 不传 `subthreadId` 时返回全部子贴进度，方便展示全局阅读概览
