# 任务队列

## 概述
任务队列模块基于 BullMQ + Redis，管理异步通知投递、图片处理，以及通过事件监听和定时任务编排发帖后的异步流程和系统清理。

## 涉及的队列

| 队列名 | 用途 | 并发控制 |
|--------|------|----------|
| `notification` | 异步批量写入通知记录 | 3 次重试，指数退避 5s |
| `image` | sharp 生成缩略图和中图 | 2 次重试，固定退避 10s |

## 涉及的核心组件

| 组件 | 类型 | 说明 |
|------|------|------|
| `PostEventsListener` | `@OnEvent('post.created')` | 监听发帖事件，协调 @提及 + 通知投递 |
| `NotificationProducer` | 生产者 | 将通知任务推入 `notification` 队列 |
| `NotificationProcessor` | `@Processor('notification')` | 消费通知任务，批量 write 到 DB |
| `ImageProcessor` | `@Processor('image')` | 消费图片处理任务，调用 MediaService.processImage |
| `CleanupTask` | `@Cron` | 每天凌晨 4 点清理过期 token 和僵尸用户 |

## 枚举

| 枚举 | 值 | 说明 |
|------|----|------|
| `NotificationType` | `reply` | 楼中楼回复通知 |
| `NotificationType` | `mention` | @提及通知 |
| `NotificationType` | `new_floor` | 新楼层通知 |
| `NotificationType` | `thread_created` | 主题帖创建通知 |
| `NotificationType` | `follow` | 关注通知 |

## 核心业务规则

### PostEventsListener 发帖事件处理

1. **预加载数据**：发帖时一次性查询（订阅者 + 双向拉黑关系），三类通知共享，避免重复 DB 查询
2. **@提及通知**：
   - 调用 `MentionsService.parseAndCreate` 解析正文中的 @用户名
   - 过滤拉黑关系（拉黑发帖人者不通知）
   - 走 `notification` 队列，**不**合并订阅者
3. **新楼层通知**（`parentPostId === null`）：
   - 通知对象：楼主/协作者 + 订阅者（去重，排除自己）
   - 过滤发帖人拉黑的用户
4. **楼中楼回复通知**（`replyToPostId` 非空）：
   - 通知对象：被回复者 + 楼主/协作者 + 订阅者（去重，排除自己）
   - 同样过滤拉黑关系
5. 所有通知均通过 `NotificationProducer.notify()` 推入 `notification` 队列异步处理

### NotificationProcessor 通知消费

- 将 `userIds[]` 批量写入 `Notification` 表（`createMany` 批量插入）
- 通知记录关联 `postId`、`threadId`、`fromUserId`，用于客户端导航

### CleanupTask 定时清理

- **每天凌晨 4 点**执行
- 清理过期的 `EmailVerification` token
- 删除注册超过 7 天仍未验证邮箱的用户

## 设计决策

- 通知异步投递：发帖 HTTP 请求不等待通知写入，由 BullMQ 在后台批量写入，保证接口响应速度
- 发帖事件中预加载拉黑和订阅数据一次，三类通知共享避免 N+1 查询
- 新楼层和楼中楼的通知接收人包含订阅者，但 @提及不包含，防止双重通知骚扰
- 定时清理凌晨 4 点执行，避开用户活跃高峰期
- 图片处理队列独立于通知队列，避免图片处理阻塞通知投递
