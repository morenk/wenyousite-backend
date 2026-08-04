# 订阅

## 概述
订阅模块提供玩家关注主题帖官方更新或指定玩家回复的能力，支持两种粒度：官方更新（THREAD）或帖内玩家（USER）。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Subscription` | 订阅记录，关联用户、主题帖、可选的被订阅用户 |

## 枚举

| 枚举 | 值 | 说明 |
|------|----|------|
| `SubscriptionType` | `THREAD` | 订阅官方更新，仅接收楼主/协作者的新正文、楼层和楼中楼 |
| `SubscriptionType` | `USER` | 订阅指定普通玩家在该主题帖下的新发言 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/subscriptions` | `@AuthRead()` | 获取当前用户的订阅列表 |
| `POST` | `/subscriptions` | `@Auth()` | 创建订阅（type + threadId + targetUserId） |
| `DELETE` | `/subscriptions/:id` | `@Auth()` | 取消指定订阅 |

## 核心业务规则

- THREAD 类型不传 `targetUserId`，USER 类型必须传 `targetUserId`
- 创建前校验主题帖访问权限和发布状态；私密帖订阅者必须是永久成员
- OWNER/COLLABORATOR 已自动接收全部帖子动态，不能创建任何帖内订阅
- THREAD 不得携带 `targetUserId`；USER 必须指定同帖 `PARTICIPANT + playerMarked=true` 的普通玩家，不能订阅自己
- 取消订阅时校验订阅归属，仅允许取消自己的订阅
- 同一用户对同一主题帖的同一目标唯一；数据库使用 `NULLS NOT DISTINCT` 索引保证 THREAD 空目标也不能重复
- 取消玩家标记、升为协作者或玩家离开时，自动清理对应 USER 订阅；非法历史数据由迁移清理
- 列表只返回仍可访问的已发布主题帖
- `findSubscribers(threadId, excludeUserId?, authorId?)` 是供 `PostEventsListener` 调用的核心接口，用于合并订阅者进入通知接收人列表
- 当提供 `authorId` 时，查询 WHERE 条件为 OR：`type='THREAD'` 或 `type='USER' AND targetUserId=authorId`，即合并"订阅整帖"与"订阅了发帖者"的用户
- **THREAD 订阅限制**：只有发帖时角色快照是 OWNER/COLLABORATOR 时，THREAD 订阅者才会收到 `new_post` / `reply` 通知；USER 订阅仅在发帖时角色快照为已标记普通玩家时触发
- 订阅通知在 `new_post` 和 `reply` 两类通知中使用，@提及通知不走订阅逻辑

## 设计决策

- 订阅粒度分为整帖和特定用户两级，而非仅整帖，允许用户自由控制通知密度
- 整帖订阅只推送楼主/协作者的官方更新，避免订阅者被帖内普通玩家的闲聊刷屏；楼主和协作者无需订阅
- `findSubscribers` 被设计为带灵活过滤条件的查询方法，因为不同通知场景需要不同的订阅者集合
- 订阅通知不包含 @提及，原因是 @提及已有独立权限规则，重复通知会造成骚扰
