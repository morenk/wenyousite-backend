# 通知投递规则

## 通知类型与触发事件

系统定义 6 类通知（Prisma 枚举 `NotificationType`），各自有独立的触发源和事件。

| 类型 | 枚举值 | 触发事件 | 触发源 | 触发位置 |
|------|--------|----------|--------|----------|
| 楼中楼回复 | `reply` | `post.created`（`parentPostId` 非空 + `!isSubthreadBody`） | `PostEventsListener` | `src/jobs/post-events.listener.ts:86` |
| @提及 | `mention` | `post.created`（正文含 `@username`） | `PostEventsListener` → `MentionsService.parseAndCreate()` | `src/jobs/post-events.listener.ts:41` |
| 新楼层 | `new_floor` | `post.created`（`parentPostId` 为空 + `!isSubthreadBody`） | `PostEventsListener` | `src/jobs/post-events.listener.ts:60` |
| 新子贴 | `subthread_created` | `post.created`（`isSubthreadBody = true`） | `PostEventsListener` | `src/jobs/post-events.listener.ts:74` |
| 新主题帖 | `thread_created` | 主题帖 PATCH published=true | `ThreadsService.update()` | `src/threads/threads.service.ts:228` |
| 被关注 | `follow` | 关注关系写入数据库 | `UsersFollowController.follow()` | `src/users/users-follow.controller.ts:33` |

**事件驱动模型**：

`post.created` 事件由 PostsService / SubthreadsService 在帖子写入后通过 `@nestjs/event-emitter` 发出，`PostEventsListener` 使用 `@OnEvent('post.created')` 监听。同一个事件可能同时触发 `mention`、`new_floor`/`subthread_created`、`reply` 多种通知。

---

## 接收者矩阵

### 1. reply — 楼中楼回复

**触发条件**：帖子 `parentPostId` 非空（即楼中楼回复）

**接收者**：

| 角色 | 获取方式 | 来源 |
|------|----------|------|
| 被回复者 | 优先取 `replyToPostId` 的作者，未指定时取 `parentPostId` 的作者 | 单个用户 ID |
| 楼主 + 协作者 | `ThreadMember.findMany({ role: { in: [OWNER, COLLABORATOR] } })` | 成员表查询 |
| 订阅者 | `SubscriptionsService.findSubscribers(threadId, authorId)` | 订阅表查询 |

**去重与过滤**：
1. 排除自己（`userId: { not: event.userId }` 在成员查询中已排除）
2. 排除被回复者 = 自己的情况（`if targetPost.authorId !== event.userId`）
3. 合并三者到 `Set` → 去重 → 过滤发帖者拉黑的用户（`authorBlockedIds`）
4. 过滤拉黑发帖者的用户（`blockedAuthorIds`，确保拉黑者也不会收到通知）

### 2. mention — @提及

**触发条件**：帖子正文中包含 `@username` 模式

**接收者**：`MentionsService.parseAndCreate()` 返回的经过权限校验的用户列表

**@提及权限规则**：
1. 已关注 → 可 @
2. 同帖玩家间可 @
3. 玩家可 @ 楼主
4. 楼主可 @ 任何人
5. @ 自己 → 不创建提及记录，不发送通知

**过滤**：被 @ 的用户如果拉黑了发帖人（即出现在 `blockedAuthorIds` 中），则从通知接收者中移除。

### 3. new_floor — 新楼层

**触发条件**：帖子 `parentPostId` 为空（即顶楼发布，非楼中楼）

**接收者**：

| 角色 | 获取方式 |
|------|----------|
| 楼主 + 协作者 | `ThreadMember.findMany({ role: { in: [OWNER, COLLABORATOR] }, userId: { not: event.userId } })` |
| 订阅者 | `SubscriptionsService.findSubscribers()` |

**去重与过滤**：
1. 成员查询已排除发帖者自己
2. 合并到 `Set` → 去重
3. 过滤发帖者拉黑的用户（`authorBlockedIds`）

### 4. subthread_created — 新子贴

**触发条件**：`post.created` 事件的 `isSubthreadBody = true`（子贴创建时附带正文）

**接收者**：

| 角色 | 获取方式 |
|------|----------|
| 楼主 + 协作者 | `ThreadMember.findMany({ role: { in: [OWNER, COLLABORATOR] }, userId: { not: event.userId } })` |
| 订阅者 | `SubscriptionsService.findSubscribers()` |

**去重与过滤**：
1. 成员查询已排除发帖者自己
2. 合并到 `Set` → 去重
3. 过滤发帖者拉黑的用户（`authorBlockedIds`）

### 5. thread_created — 新主题帖

**触发条件**：`PATCH /threads/:id { published: true }` 发布草稿时

**接收者**：创建者的所有粉丝

```typescript
const followers = await this.prisma.userFollow.findMany({
  where: { followingId: userId },
  select: { followerId: true },
});
```

- 无去重需求（粉丝集合天然唯一）
- 不检查拉黑关系（用户无法阻止被关注者发帖的通知）
- 使用 `.catch(() => {})` 吞掉队列异常，不影响主流程

### 6. follow — 被关注

**触发条件**：关注关系写入数据库（upsert）

**接收者**：被关注者（单个用户）

- 不通知自己关注自己（前置判断 `if user.id === targetId return`）
- 使用 `.catch(() => {})` 吞掉队列异常

---

## 去重与过滤机制

所有通知类型共享以下 3 层过滤（`src/jobs/post-events.listener.ts:23-39`）：

```typescript
// 预加载：订阅者、拉黑关系（三类通知共用，一次 DB 查询）
const [subscribers, blockedByAuthor, blocksOfAuthor] = await Promise.all([
  this.subscriptionsService.findSubscribers(...),
  this.prisma.userBlock.findMany({ where: { blockedId: event.userId } }),  // 谁拉黑了发帖人
  this.prisma.userBlock.findMany({ where: { blockerId: event.userId } }),  // 发帖人拉黑了谁
]);
const blockedAuthorIds = new Set(blockedByAuthor.map(b => b.blockerId));
const authorBlockedIds = new Set(blocksOfAuthor.map(b => b.blockedId));
```

| 过滤层 | Set 名称 | 含义 | 适用场景 |
|--------|----------|------|----------|
| 拉黑发帖人 | `blockedAuthorIds` | 拉黑了发帖人的用户 ID 集合 | mention：如果被 @ 者拉黑了发帖人则移除 |
| 被发帖人拉黑 | `authorBlockedIds` | 被发帖人拉黑的用户 ID 集合 | reply / new_floor：发帖人拉黑的用户不收到通知 |
| 去重 | `new Set([...ids])` | JavaScript Set 自动去重 | reply / new_floor：合并多来源接收者时消除重复 |

> **注意**：`blockedAuthorIds` 和 `authorBlockedIds` 是互补的拉黑关系。前者表示"谁拉黑了发帖人"，后者表示"发帖人拉黑了谁"。两者在不同场景下各自独立适用。

---

## 订阅投递集成

**订阅类型**（Prisma 枚举 `SubscriptionType`）：

| 类型 | 值 | 含义 |
|------|-----|------|
| 帖订阅 | `THREAD` | 订阅整个主题帖，任何新回复都收到通知 |
| 人订阅 | `USER` | 订阅帖内某个用户的发言，仅该用户发帖时通知 |

**调用入口**（`src/jobs/post-events.listener.ts:24`）：

```typescript
this.subscriptionsService.findSubscribers(
  event.threadId,   // 主题帖 ID
  event.userId,     // 排除该用户（不给自己发通知）
  event.userId,     // 作者 ID（用于匹配 USER 类型订阅者）
)
```

**查询逻辑**（`src/subscriptions/subscriptions.service.ts:50`）：

```sql
SELECT userId, type, targetUserId
FROM subscriptions
WHERE threadId = {threadId}
  AND userId != {excludeUserId}
  AND (
    type = 'THREAD'               -- 订阅整帖
    OR (type = 'USER' AND targetUserId = {authorId})  -- 订阅该作者
  )
```

返回的订阅者列表被合并到 `reply` 和 `new_floor` 通知的接收者集合中。

---

## 通知数据结构

`Notification` 模型（`prisma/schema.prisma:352`）：

| 字段 | 类型 | 用途 |
|------|------|------|
| `id` | `String (cuid)` | 主键 |
| `userId` | `String` | 接收者 ID（索引键 `[userId, isRead, createdAt]`） |
| `type` | `NotificationType` | 通知类型枚举 |
| `content` | `String?` | 通知摘要文本含正文预览（前 100 字），客户端可直接渲染 |
| `postId` | `String?` | 关联帖子 ID，前端可跳转到具体楼层 |
| `threadId` | `String?` | 关联主题帖 ID，前端可跳转到帖子列表 |
| `fromUserId` | `String?` | 操作者 ID，前端可展示"来自 xxx" |
| `isRead` | `Boolean` | 阅读状态，默认 `false` |
| `createdAt` | `DateTime` | 创建时间 |

**前端导航支持**：

- 有 `postId` → 跳转到具体楼层
- 无 `postId` 但有 `threadId` → 跳转到主题帖
- 有 `fromUserId` → 展示操作者头像和名称

**示例数据**：

```json
{
  "id": "cm7x...",
  "userId": "user_owner_id",
  "type": "reply",
  "content": "测试用户 回复了：原来如此，那我改一下这个设定看看效果怎么样，你觉得呢...",
  "postId": "post_abc_id",
  "threadId": "thread_xyz_id",
  "fromUserId": "user_reply_author_id",
  "isRead": false,
  "createdAt": "2026-07-28T12:00:00.000Z"
}
```

**通知文案格式**：

| 类型 | content 格式 |
|------|-------------|
| `new_floor` | `{username} 发布了新楼层：{正文前100字}` |
| `reply` | `{username} 回复了：{正文前100字}` |
| `mention` | `{username} 在「{subthreadTitle}」提到了你：{正文前100字}` |
| `subthread_created` | `{username} 创建了新子贴「{subthreadTitle}」：{正文前100字}` |
| `thread_created` | `{username}创建了新主题帖`（无正文预览） |
| `follow` | `{username}关注了你` |

---

## 拉黑影响

拉黑是双向阻断机制，通过 `UserBlock` 表的 `[blockerId, blockedId]` 唯一约束实现。

| 影响项 | 说明 | 实现位置 |
|--------|------|----------|
| 不通知拉黑者 | `mention` 类型中，若被 @ 者拉黑了发帖人，排除该被 @ 者 | `src/jobs/post-events.listener.ts:47` |
| 不通知被拉黑者 | `reply` / `new_floor` 类型中，发帖人拉黑的用户从接收者集合中移除 | `src/jobs/post-events.listener.ts:72,104` |
| 不发帖 | 拉黑者的帖子对被拉黑者不可见（由 BlockGuard 全局拦截） | `src/common/guards/block.guard.ts` |
| 不影响关注通知 | `thread_created` / `follow` 不检查拉黑关系 | — |

> **注意**：拉黑检查在 `queue.add()` 之前完成，而非在 Processor 中再次检查。这意味着接收者列表在入队时已经确定且干净。

---

## 队列投递

### 生产者 → 队列 → 消费者

```
NotificationProducer.notify()         BullMQ 'notification'        NotificationProcessor
     │                                       队列
     │  queue.add({ type, recipients,    ╔═══════════════╗
     │    content, postId, threadId,     ║  Redis List   ║
     │    fromUserId })                  ╚═══════════════╝
     │                                                              │
     │                                                              ▼
     │                                                        createMany()
     │                                                              │
     │                                                              ▼
     └───────────────────────────────────────────────────  Prisma.notification
```

**生产者**（`src/jobs/notification.producer.ts:10`）：

```typescript
async notify(type: string, recipients: string[], content: string, opts?) {
  if (recipients.length === 0) return;         // 空列表直接跳过
  await this.notificationQueue.add(type, {
    type, recipients, content,                  // 载荷：类型 + 接收者数组 + 摘要文本
    ...opts,                                    // 可选 postId / threadId / fromUserId
  }, {
    removeOnComplete: { age: 3600 * 24 },      // 成功任务 24h 后清理
    removeOnFail: { age: 3600 * 24 * 7 },      // 失败任务 7d 后清理
  });
}
```

**消费者**（`src/jobs/notification.processor.ts:31`）：

```typescript
private async createNotifications(userIds, type, content, postId?, threadId?, fromUserId?) {
  if (userIds.length === 0) return;
  const data = userIds.map((userId) => ({
    userId, type, content, postId, threadId, fromUserId
  }));
  await this.prisma.notification.createMany({ data });
}
```

**重试策略**（`src/jobs/jobs.module.ts:16`）：

| 参数 | 值 | 说明 |
|------|-----|------|
| `attempts` | 3 | 最多 3 次重试 |
| `backoff.type` | `exponential` | 指数退避 |
| `backoff.delay` | 5000ms | 初始延迟 5 秒 |
| `removeOnComplete.age` | 86400s | 成功任务保留 24 小时用于调试 |

**队列配置两处注册**（与 `image` 队列相同模式）：

| 模块 | 位置 | 用途 |
|------|------|------|
| `JobsModule` | `src/jobs/jobs.module.ts:17-23` | 注册队列 + 默认配置 + `NotificationProcessor` 消费 |
| `app.module.ts` | 根模块 | 全局注册 BullModule.forRoot（Redis 连接），队列由此接入 |
