# 通知模块

## 概述

站内通知的列表查询、未读计数、标记已读/未读、单条删除、一键全部已读、按类型过滤。通知由其他模块（关注、发帖、点赞、@提及、管理员）通过 BullMQ 队列异步创建，本模块提供查询、标注和删除。系统通知（`system` 类型）`fromUserId` 为 null，混在普通通知列表中由前端通过该字段区分渲染。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Notification` | 通知实体（userId + type + content + payload + 导航字段） |

| 枚举 | 值 |
|------|-----|
| `NotificationType` | reply, mention, new_post, thread_created, follow, like, system |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/notifications?cursor=&type=` | AuthRead | 通知列表（Cursor 分页，支持按类型过滤，如 type=mention,reply） |
| GET | `/notifications/unread` | AuthRead | 未读通知数量 |
| PATCH | `/notifications/:id` | AuthRead | 标记单条通知阅读状态（Body: { isRead: boolean }） |
| DELETE | `/notifications/:id` | AuthRead | 硬删除单条通知 |
| POST | `/notifications/read-all` | AuthRead | 一键标记全部未读为已读 |

所有端点统一使用 `@AuthRead()` 守卫。

## 核心业务规则

- 通知列表按 createdAt DESC 排序，Cursor 分页（默认 20 条/页，最大 50）
- 列表查询 include 关联关系：post（id/floorNumber/parentPostId/deletedAt）、thread（id/title/deletedAt）、fromUser（id/username/avatar/deletedAt），供前端拼接跳转 URL 并识别已删除的跳转对象。系统通知 fromUser 为 null
- 列表查询自动过滤已软删帖/子贴关联的通知
- 支持按类型过滤（`?type=mention,reply` 逗号分隔多个），兼容旧类型 `new_floor` / `subthread_created`（自动映射为 `new_post`）
- 未读数基于 `isRead: false` 的 count 查询
- `setReadStatus` 支持标记已读（isRead: true）和标记未读（isRead: false）
- `remove` 为硬删除，使用 `deleteMany`（where id + userId），即使不存在也不报错；系统通知同样支持删除
- 通知创建由 NotificationsService.create / createMany 方法提供，由 NotificationProducer（BullMQ）调用
- 通知创建由 NotificationsService.create / createMany 方法提供，由 NotificationProducer（BullMQ）调用
- 通知创建时的结构化导航字段（postId / threadId / fromUserId）在创建时写入，查询时直接关联返回
- 定时清理任务每天凌晨 4 点清理 90 天前已读的通知
- `payload` JSON 字段携带通知的结构化数据（actorName、action、preview 等），供前端灵活渲染
- 通知摘要先把 Markdown 图片语法替换为 `[图片]`，再剥离其他 Markdown 标记；纯图片回复仍有可识别预览，同时图片 alt（包括 Milkdown 的 `1.00` 比例占位）不会进入通知文案
- 摘要把 Milkdown 转义的字面标点（`\<` `\>` `\*` `\_` `` \` `` `\~` 等）统一替换为私有区占位符再交给 remove-markdown，清理后还原：字面字符完整保留、不残留孤立 `\`，且不会被强调/删除线/行内代码等正则误删；普通反斜杠路径（如 `C:\temp`）不受影响
- 字面 `<` 也被占位保护，避免跨行 `<...>` 被误判为 HTML 标签整段吞掉（回复只有 `<` 与 `>` 时预览会变空）；真实引用块（`> 文本`）与真实 Markdown 语法仍被清理
- Milkdown 硬换行（行尾反斜杠 `\` + 换行）还原为普通换行，避免预览残留字面 `\`

## 设计决策

- **读写的关注点分离**：本模块仅负责通知的查询和已读管理；通知的创建由 BullMQ notification 队列异步处理，保证发帖/关注/点赞操作不因通知投递而阻塞
- **结构化导航字段 + payload**：在 Notification 表冗余存储 postId / threadId / fromUserId 以及 payload JSON，前端可直接读取跳转信息和结构化渲染数据，无需额外查询
- **内容兼容**：保留 `content` 纯文本字段作为降级渲染，`payload` 为可选 JSON 字段供新版客户端使用
- **Cursor 分页而非偏移分页**：通知列表高频查询且数据持续增长，Cursor 分页避免 offset 在大数据量下性能衰减
- **硬删除而非软删除**：通知是可丢弃的 transient 数据，硬删除减少存储开销，无需维护 deletedAt 状态
- **系统通知混在列表**：系统通知与社交通知共用同一列表，通过 `fromUserId: null` 区分，前端据此展示系统图标/样式
- **定时清理**：90 天已读通知自动删除，防止表无限增长
