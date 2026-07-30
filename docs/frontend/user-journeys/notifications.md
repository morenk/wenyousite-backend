# 用户旅程：通知

> 站内通知的列表、未读数、标记已读、删除、跳转。

## AI 执行摘要

- **涉及页面**：通知列表页 / 通知红点 / 全局导航
- **涉及接口**：`GET /notifications`、`GET /notifications/unread`、`PATCH /notifications/:id`、`POST /notifications/read-all`、`DELETE /notifications/:id`
- **关键状态**：`isRead`、`NotificationType`、`postId`、`threadId`、`fromUserId`
- **常见错误**：`40100` 未登录

---

## 通知类型

| 类型 | 触发场景 | 跳转目标 |
|------|---------|---------|
| `reply` | 有人回复了你的帖子 | 对应帖子或楼层 |
| `mention` | 有人在帖子中 @了你 | 对应帖子 |
| `new_post` | 你订阅的帖子有新楼层/子贴 | 对应主题帖 |
| `thread_created` | 你关注的用户创建了主题帖 | 对应主题帖 |
| `follow` | 有人关注了你 | 关注者资料页 |
| `like` | 有人赞了你的主题帖 | 对应主题帖 |
| `system` | 系统通知 | 根据 payload 决定 |

---

## 通知列表

```http
GET /api/v1/notifications?type=mention,reply&cursor=clx...
Authorization: Bearer <accessToken>
```

### Query 参数

| 参数 | 说明 |
|------|------|
| `cursor` | 分页游标，首页不传 |
| `type` | 按类型过滤，逗号分隔，如 `type=mention,reply` |

### 响应

```json
{
  "code": 0,
  "data": [
    {
      "id": "n1",
      "type": "mention",
      "content": "张三 在帖子中提到了你",
      "isRead": false,
      "createdAt": "...",
      "postId": "p1",
      "threadId": "t1",
      "fromUserId": "u2",
      "fromUser": {
        "id": "u2",
        "username": "张三",
        "avatar": "..."
      },
      "thread": {
        "id": "t1",
        "title": "主题帖标题"
      },
      "post": {
        "id": "p1",
        "floorNumber": 5,
        "parentPostId": null
      },
      "payload": {
        "actorName": "张三",
        "action": "mention",
        "preview": "..."
      }
    }
  ],
  "meta": {
    "cursor": "n1",
    "hasMore": true
  }
}
```

### 系统通知

`fromUserId` 为 `null` 的是系统通知。前端据此展示系统图标或不同样式。

---

## 未读通知数

```http
GET /api/v1/notifications/unread
Authorization: Bearer <accessToken>
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "unreadCount": 5
  }
}
```

**前端应用**：
- App 图标红点
- 站内导航栏通知图标红点
- 通知列表页 tab  badge

---

## 标记单条通知已读

```http
PATCH /api/v1/notifications/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "isRead": true
}
```

也支持标记为未读：`isRead: false`。

---

## 一键全部已读

```http
POST /api/v1/notifications/read-all
Authorization: Bearer <accessToken>
```

---

## 删除通知

```http
DELETE /api/v1/notifications/:id
Authorization: Bearer <accessToken>
```

**注意**：通知是硬删除，不保留历史。

---

## 前端跳转逻辑

| 通知类型 | 跳转逻辑 |
|---------|---------|
| `reply` / `mention` / `new_post` | `/threads/:threadId`，滚动到对应楼层或子贴 |
| `thread_created` | `/threads/:threadId` |
| `like` | `/threads/:threadId` |
| `follow` | `/users/:fromUserId` |
| `system` | 根据 `payload` 中的 `targetUrl` 或默认首页 |

---

## 前端实现建议

### 通知列表页

- 按时间倒序排列。
- 未读通知高亮显示。
- 点击通知后：
  1. 标记为已读
  2. 跳转到对应页面
- 支持按类型筛选（Tab 切换）。

### 通知红点

```typescript
// 进入 App 或首页时拉取
const { data } = await api.get('/notifications/unread');
setUnreadCount(data.unreadCount);
```

### 下拉刷新

通知列表支持下拉刷新获取最新通知。

### 分页加载

```typescript
let cursor = null;
let hasMore = true;
while (hasMore) {
  const params = cursor ? { cursor } : {};
  const res = await api.get('/notifications', { params });
  notifications.push(...res.data.data);
  cursor = res.data.meta.cursor;
  hasMore = res.data.meta.hasMore;
}
```

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 未登录 | 40100 | 跳转登录 |
| 通知不存在 | 40400 | 静默移除该通知 |

---

## 状态机

```
[用户收到通知]
        │
        ▼
   [未读状态 isRead=false]
        │
        ├─ 用户点击通知 ──> 标记已读 + 跳转
        │
        ├─ 用户一键已读 ──> 全部标记已读
        │
        └─ 用户删除通知 ──> 从列表移除
```
