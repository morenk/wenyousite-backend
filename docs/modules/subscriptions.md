# 订阅

## 概述
订阅模块提供玩家关注主题帖回复的能力，支持两种粒度：订阅整帖（THREAD）或订阅帖内某个用户（USER）。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Subscription` | 订阅记录，关联用户、主题帖、可选的被订阅用户 |

## 枚举

| 枚举 | 值 | 说明 |
|------|----|------|
| `SubscriptionType` | `THREAD` | 订阅整个主题帖下所有新帖 |
| `SubscriptionType` | `USER` | 订阅指定用户在该主题帖下的所有回复 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/subscriptions` | `@AuthRead()` | 获取当前用户的订阅列表 |
| `POST` | `/subscriptions` | `@Auth()` | 创建订阅（type + threadId + targetUserId） |
| `DELETE` | `/subscriptions/:id` | `@Auth()` | 取消指定订阅 |

## 核心业务规则

- THREAD 类型不传 `targetUserId`，USER 类型必须传 `targetUserId`
- 创建前校验主题帖和目标用户是否存在，已订阅则返回 `ConflictException`
- 取消订阅时校验订阅归属，仅允许取消自己的订阅
- 同一用户对同一主题帖的同一 targetUserId 唯一（通过 `@@unique([userId, threadId, targetUserId])` 约束）
- `findSubscribers(threadId, excludeUserId?, authorId?)` 是供 `PostEventsListener` 调用的核心接口，用于合并订阅者进入通知接收人列表
- 当提供 `authorId` 时，查询 WHERE 条件为 OR：`type='THREAD'` 或 `type='USER' AND targetUserId=authorId`，即合并"订阅整帖"与"订阅了发帖者"的用户
- 订阅通知在 `new_post` 和 `reply` 两类通知中使用，@提及通知不走订阅逻辑

## 设计决策

- 订阅粒度分为整帖和特定用户两级，而非仅整帖，允许用户自由控制通知密度
- `findSubscribers` 被设计为带灵活过滤条件的查询方法，因为不同通知场景需要不同的订阅者集合
- 订阅通知不包含 @提及，原因是 @提及已有独立权限规则，重复通知会造成骚扰
