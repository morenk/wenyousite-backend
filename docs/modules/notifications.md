# 通知模块

## 概述

站内通知的列表查询、未读计数、单条标记已读、一键全部已读。通知由其他模块（关注、发帖、@提及）通过 BullMQ 队列异步创建，本模块仅负责查询和已读管理。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Notification` | 通知实体（userId + type + content + 导航字段） |

| 枚举 | 值 |
|------|-----|
| `NotificationType` | reply, mention, new_floor, subthread_created, thread_created, follow |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/notifications?cursor=` | AuthRead | 通知列表（Cursor 分页，含关联信息） |
| GET | `/notifications/unread` | AuthRead | 未读通知数量 |
| PATCH | `/notifications/:id/read` | AuthRead | 标记单条通知为已读 |
| POST | `/notifications/read-all` | AuthRead | 一键标记全部未读为已读 |

所有端点统一使用 `@AuthRead()` 守卫。

## 核心业务规则

- 通知列表按 createdAt DESC 排序，Cursor 分页（默认 20 条/页，最大 50）
- 列表查询 include 关联关系：post（id/floorNumber/parentPostId）、thread（id/title）、fromUser（id/username/nickname/avatar），供前端拼接跳转 URL
- 未读数基于 `isRead: false` 的 count 查询
- `markAsRead` 使用 `updateMany`（where id + userId），即使已是已读状态也不报错
- `markAllAsRead` 使用 `updateMany`（where userId + isRead: false），批量更新
- 通知创建由 NotificationsService.create / createMany 方法提供，由 NotificationProducer（BullMQ）调用
- 通知创建时的结构化导航字段（postId / threadId / fromUserId）在创建时写入，查询时直接关联返回

## 设计决策

- **读写的关注点分离**：本模块仅负责通知的查询和已读管理；通知的创建由 BullMQ notification 队列异步处理，保证发帖/关注操作不因通知投递而阻塞
- **结构化导航字段**：在 Notification 表冗余存储 postId / threadId / fromUserId，避免前端需额外查询拼接跳转 URL
- **Cursor 分页而非偏移分页**：通知列表高频查询且数据持续增长，Cursor 分页避免 offset 在大数据量下性能衰减
- **include 关联而非 DTO 映射**：通知响应直接 include 关联模型，减少服务层 DTO 转换代码，关联字段由 Prisma select 控制暴露范围
- **updateMany 而非 update**：markAsRead 和 markAllAsRead 使用 updateMany，避免先查后改的冗余查询，且幂等（重复标记不报错）
