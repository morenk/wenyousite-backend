# 通知模块

## 概述

站内通知的列表查询、未读计数、标记已读/未读、单条删除、一键全部已读、按类型过滤。关注、发帖、点赞、@提及和管理员活动通过 `NotificationProducer` 等待通知直接、幂等地写入 PostgreSQL；可靠业务事件在通知提交后才由 Outbox 确认。本模块同时提供查询、标注和删除。系统通知（`system` 类型）`fromUserId` 为 null，混在普通通知列表中由前端通过该字段区分渲染。响应中的 `type` 使用 OpenAPI 枚举，Web 与 Flutter 必须对未来新增的未知值安全降级。

## 涉及的模型

| 模型           | 用途                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `Notification` | 通知实体（userId + type + content + payload + 导航字段 + 稳定 eventKey） |

| 枚举               | 值                                                                            |
| ------------------ | ----------------------------------------------------------------------------- |
| `NotificationType` | reply, mention, new_post, thread_created, follow, like, tip, level_up, system |

## API 端点

| Method | Path                           | Guard    | 描述                                                           |
| ------ | ------------------------------ | -------- | -------------------------------------------------------------- |
| GET    | `/notifications?cursor=&type=` | AuthRead | 通知列表（Cursor 分页，支持按类型过滤，如 type=mention,reply） |
| GET    | `/notifications/unread`        | AuthRead | 未读通知数量                                                   |
| PATCH  | `/notifications/:id`           | AuthRead | 标记单条通知阅读状态（Body: { isRead: boolean }）              |
| DELETE | `/notifications/:id`           | AuthRead | 硬删除单条通知                                                 |
| POST   | `/notifications/read-all`      | AuthRead | 一键标记全部未读为已读                                         |

所有端点统一使用 `@AuthRead()` 守卫。

## 核心业务规则

- 通知列表按 createdAt DESC 排序，Cursor 分页（默认 20 条/页，最大 50）
- 列表查询 include 关联关系：post（id/floorNumber/parentPostId/deletedAt）、thread（id/title/deletedAt）、fromUser（id/username/avatar/deletedAt），供前端拼接跳转 URL 并识别已删除的跳转对象。系统通知 fromUser 为 null
- 列表查询自动过滤已软删帖、已软删子贴及其主题帖关联的通知；动态评论通知同时要求动态和目标评论均未删除。无目标的系统/关注通知仍保留
- 支持按类型过滤（`?type=mention,reply` 逗号分隔多个），兼容旧类型 `new_floor` / `subthread_created`（自动映射为 `new_post`）
- 未读数与列表共用同一组有效性过滤条件，基于 `isRead: false` count，避免角标与列表不一致
- `setReadStatus` 支持标记已读（isRead: true）和标记未读（isRead: false）
- `remove` 为硬删除，使用 `deleteMany`（where id + userId），即使不存在也不报错；系统通知同样支持删除
- 通知创建由 `NotificationDeliveryService` 执行，`NotificationProducer` 是业务模块的统一应用入口
- 通知创建时的结构化导航字段（postId / threadId / fromUserId）在创建时写入，查询时直接关联返回
- `eventKey` 是同一业务事件的稳定幂等键，实际按 `userId + eventKey` 唯一；队列重试、编辑重试、关注/发布/点赞/系统通知重投不会重复插入
- 同一篇帖子中，已收到显式 `mention` 的用户不会再收到该事件的 `new_post` / `reply` 次级通知
- 同一条回复的显式 `mention` 优先级高于 `reply`，只保留一次提醒；同一批通知写入使用 `skipDuplicates` 兜底并发重试
- 点赞通知按主题帖聚合；聚合事务使用 Serializable 隔离级别，并在 payload 中保留最近事件键，避免并发丢计数或重试重复累加
- 定时清理任务每天凌晨 4 点清理 90 天前已读的通知
- 响应把历史 `payload` 规范化为带 `schemaVersion=1` 的类型结构，并额外给出 `target.kind`（post/thread/user/none）及相应 ID；新版 Web/Flutter 按 target 导航，`content` 继续作为旧数据和未知类型的降级字段
- 通知落库后按稳定事件键尽力进入 `mobile-push` 队列；FCM 只发送通用隐私提示，客户端回到 API 拉取权威内容。推送入队失败不会回滚或删除已提交通知，只输出不含正文和用户资料的结构化告警；推送本身允许延迟、折叠或丢失
- 通知摘要先把 Markdown 图片语法替换为 `[图片]`，再剥离其他 Markdown 标记；纯图片回复仍有可识别预览，同时图片 alt（包括 Milkdown 的 `1.00` 比例占位）不会进入通知文案
- 通知摘要会把顶层空段落协议标记（`<br />` 及历史变体）转换为空白并折叠，避免空行撑高或标签泄漏
- 摘要把 Milkdown 转义的字面标点（`\<` `\>` `\*` `\_` `` \` `` `\~` 等）统一替换为私有区占位符再交给 remove-markdown，清理后还原：字面字符完整保留、不残留孤立 `\`，且不会被强调/删除线/行内代码等正则误删；普通反斜杠路径（如 `C:\temp`）不受影响
- 字面 `<` 也被占位保护，避免跨行 `<...>` 被误判为 HTML 标签整段吞掉（回复只有 `<` 与 `>` 时预览会变空）；真实引用块（`> 文本`）与真实 Markdown 语法仍被清理
- Milkdown 硬换行（行尾反斜杠 `\` + 换行）还原为普通换行，避免预览残留字面 `\`

## 设计决策

- **权威状态不依赖 Redis 队列**：业务请求先写 Outbox，后台监听器等待通知直接落库后才确认事件；Redis 故障不会让已经提交的业务事件与站内通知永久脱节
- **结构化导航字段 + payload**：在 Notification 表冗余存储 postId / threadId / fromUserId 以及 payload JSON，API 映射为版本化 payload 与具名 target，客户端无需猜测字段组合
- **内容兼容**：保留 `content` 纯文本字段作为降级渲染，`payload` 为可选 JSON 字段供新版客户端使用
- **Cursor 分页而非偏移分页**：通知列表高频查询且数据持续增长，Cursor 分页避免 offset 在大数据量下性能衰减
- **硬删除而非软删除**：通知是可丢弃的 transient 数据，硬删除减少存储开销，无需维护 deletedAt 状态
- **系统通知混在列表**：系统通知与社交通知共用同一列表，通过 `fromUserId: null` 区分，前端据此展示系统图标/样式
- **定时清理**：90 天已读通知自动删除，防止表无限增长
