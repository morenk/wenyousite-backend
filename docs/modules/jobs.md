# 任务队列

## 概述

后台任务按业务归属拆分：图片队列由 `media` 模块拥有，表情规范化队列由 `stickers` 模块拥有，FCM 队列由 `mobile-push` 模块拥有，`jobs` 模块仅负责定时维护。权威站内通知由业务监听器直接、幂等地写入 PostgreSQL，不再经过 Redis 中间队列；关键业务事件仍由 `outbox` 模块可靠分发。

## 涉及的队列

| 队列名        | 用途                                           | 并发控制               |
| ------------- | ---------------------------------------------- | ---------------------- |
| `image`       | sharp 生成缩略图和中图                         | 2 次重试，固定退避 10s |
| `sticker`     | sharp 规范化静态/动态 WebP、哈希去重并加入收藏 | 2 次重试，固定退避 10s |
| `mobile-push` | FCM 隐私通知；投递前复查 mobile 登录终端       | 3 次重试，指数退避     |

## 涉及的核心组件

| 组件                                   | 类型                        | 说明                                                                                   |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `OutboxDispatcher`                     | `@Interval`                 | 竞争领取并重试可靠领域事件（`src/outbox`）                                             |
| `PostEventsListener`                   | `@OnEvent('post.created')`  | 协调 @提及、通知和 Redis 投影（`src/post-activity`）                                   |
| `NotificationProducer/DeliveryService` | 应用服务                    | 等待权威通知按稳定事件键幂等落库，再尽力安排移动推送（`src/notifications`）            |
| `NotificationCampaignService`          | `@Interval`                 | 每 30 秒领取到期或租约过期的活动，按 500 人持久化游标并以活动事件键幂等投递            |
| `ImageProcessor`                       | `@Processor('image')`       | 调用 MediaService 生成衍生图（`src/media`）                                            |
| `MediaProcessingRecoveryService`       | `@Interval`                 | 启动时及每 10 分钟修复超过 15 分钟仍为 PROCESSING 的图片任务                           |
| `StickerProcessor`                     | `@Processor('sticker')`     | 规范化表情并完成幂等导入（`src/stickers`）                                             |
| `StickerProcessingRecoveryService`     | `@Interval`                 | 启动时及每 10 分钟修复超过 15 分钟仍为 PROCESSING 的表情任务                           |
| `MobilePushProcessor`                  | `@Processor('mobile-push')` | 验证终端状态、发送 FCM、停用无效 token（`src/mobile-push`）                            |
| `CleanupTask`                          | `@Cron`                     | 清理过期 token、验证码、已处理 Outbox、失败/未完成媒体与终态表情导入记录（`src/jobs`） |

## 枚举

| 枚举               | 值               | 说明            |
| ------------------ | ---------------- | --------------- |
| `NotificationType` | `reply`          | 主题/楼层回复通知 |
| `NotificationType` | `mention`        | @提及通知       |
| `NotificationType` | `new_post`       | 新正文/楼层通知 |
| `NotificationType` | `thread_created` | 主题帖创建通知  |
| `NotificationType` | `follow`         | 关注通知        |
| `NotificationType` | `like`           | 点赞通知        |
| `NotificationType` | `system`         | 系统通知        |

## 核心业务规则

### PostEventsListener 发帖事件处理

1. **预加载数据**：发帖时一次性查询（订阅者 + 双向拉黑关系），三类通知共享，避免重复 DB 查询
2. **@提及通知**：
   - 调用 `MentionsService.parseAndCreate` 解析正文中的 @用户名
   - 过滤拉黑关系（拉黑发帖人者不通知）
   - 直接走幂等通知投递服务，**不**合并订阅者
3. **新楼层通知**（`parentPostId === null`）：
   - 主题楼主收到 `reply` 直接互动；非作者协作者和实际订阅者收到 `new_post` 内容更新
   - 子贴正文仍向全部非作者管理者和实际订阅者发送 `new_post`
   - 过滤发帖人拉黑的用户
4. **楼中楼回复通知**（`replyToPostId` 非空）：
   - 直接被回复者收到 `reply`；其他管理者和有效订阅者收到 `new_post/new_reply`
   - 同样过滤拉黑关系
5. 所有通知均通过 `NotificationProducer.notify()` 等待 PostgreSQL 权威记录提交；失败会使 Outbox 保持未确认并退避重试

### NotificationDeliveryService 通知投递

- 将 `userIds[]` 批量写入 `Notification` 表（`createMany` 批量插入）
- 通知记录关联 `postId`、`threadId`、`fromUserId`，用于客户端导航
- `userId + eventKey` 唯一约束和查询过滤共同保证 Outbox 重放不重复落库
- 落库后以稳定事件键尽力安排 FCM；推送入队失败只记录脱敏告警，不回滚权威通知

### 图片与表情任务恢复

- 图片进入 `PROCESSING` 时记录 `processingStartedAt`；表情使用 `updatedAt` 作为处理活跃时间。
- 启动时及每 10 分钟扫描最多 100 条超过 15 分钟未推进的任务。等待、执行、延迟和优先队列任务保持不动；失败任务落为 `FAILED`；任务缺失或已完成但数据库未收敛时按稳定 `jobId` 重新入队。
- 恢复器使用进程内运行锁避免同一实例重叠扫描；单次失败不会阻止应用启动，错误日志只记录机器错误码和业务 ID。

### CleanupTask 定时清理

- **每天凌晨 4 点**执行
- 清理过期的 `EmailVerification` token
- 清理过期的注册/换绑/重置验证码记录
- 清理 7 天前已确认的 Outbox；绝不删除未处理事件
- 清理超过 24 小时未确认的上传和超过 7 天的失败媒体；已完成媒体在建立规范化引用账本前保守保留
- 清理 7 天前完成或失败的表情导入记录；已完成表情资产可能被 Markdown 字符串引用，在建立规范化引用账本前保守保留，不执行自动对象删除
- 停用 90 天未更新的移动推送终端；发送时仍会再次核对 refresh-token family 是否活跃

## 设计决策

- 通知可靠投递：HTTP 请求只在业务事务写 Outbox；后台分发器等待通知直接落入 PostgreSQL 后才确认事件
- 关键事件至少一次投递；通知事件键和 Redis 权威值覆盖保证重试幂等
- 通知活动每批成功落库后持久化接收人游标；进程中断或数据库故障会在租约过期后续传，连续 10 次领取失败才进入失败终态
- 发帖事件中预加载拉黑和订阅数据一次，三类通知共享避免 N+1 查询
- 新楼层和楼中楼的通知接收人包含订阅者，但 @提及不包含，防止双重通知骚扰
- 定时清理凌晨 4 点执行，避开用户活跃高峰期
- 图片和表情处理队列与权威通知落库解耦，避免耗时图像任务阻塞通知投递
