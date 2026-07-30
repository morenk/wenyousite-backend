# API 速查：订阅（Subscriptions）

> 订阅主题帖或帖内特定用户的回复，接收新帖通知。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/subscriptions` | AuthRead | 我的订阅列表 |
| POST | `/subscriptions` | Auth | 创建订阅 |
| DELETE | `/subscriptions/:id` | Auth | 取消订阅 |

---

## 订阅类型

| 类型 | 说明 | targetUserId |
|------|------|-------------|
| `THREAD` | 订阅整个主题帖下的所有新帖 | 不传 |
| `USER` | 订阅指定用户在该主题帖下的所有回复 | 必须传 |

---

## GET /subscriptions

获取当前用户的订阅列表。

```http
GET /api/v1/subscriptions
Authorization: Bearer <accessToken>
```

### 响应

```json
{
  "code": 0,
  "data": [
    {
      "id": "sub1",
      "type": "THREAD",
      "threadId": "t1",
      "targetUserId": null,
      "createdAt": "...",
      "thread": { "id": "t1", "title": "..." }
    },
    {
      "id": "sub2",
      "type": "USER",
      "threadId": "t1",
      "targetUserId": "u2",
      "createdAt": "...",
      "thread": { "id": "t1", "title": "..." },
      "targetUser": { "id": "u2", "username": "..." }
    }
  ]
}
```

---

## POST /subscriptions

创建订阅。

```http
POST /api/v1/subscriptions
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "threadId": "t1",
  "type": "USER",
  "targetUserId": "u2"
}
```

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| threadId | string | 是 | 主题帖 ID |
| type | enum | 是 | `THREAD` 或 `USER` |
| targetUserId | string | 否 | `USER` 类型必填 |

### 规则

- 主题帖和目标用户必须存在。
- 同一用户对同一主题帖的同一 targetUserId 只能订阅一次。
- 已订阅返回 409 Conflict。
- 创建订阅需要邮箱已验证（`@Auth()`）。

---

## DELETE /subscriptions/:id

取消订阅。

```http
DELETE /api/v1/subscriptions/:id
Authorization: Bearer <accessToken>
```

### 规则

- 只能取消自己的订阅。

---

## 前端实现建议

### 主题帖详情页订阅入口

- "订阅本帖"按钮：创建 `THREAD` 类型订阅。
- "订阅该玩家"按钮（在帖子作者菜单中）：创建 `USER` 类型订阅。
- 已订阅时按钮变为"取消订阅"。

### 我的订阅页

- 列表展示所有订阅。
- 显示订阅类型和关联的主题帖/用户。
- 支持取消订阅。

### 与通知的关系

订阅会在以下场景触发 `new_post` 通知：
- `THREAD` 订阅：主题帖有新楼层/子贴时通知。
- `USER` 订阅：被订阅用户在该主题帖下发帖时通知。

@提及通知不走订阅逻辑。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 未登录 | 40100 | 跳转登录 |
| 邮箱未验证 | 40300 | "请先验证邮箱" |
| 重复订阅 | 40900 | "已订阅" |
| 主题帖不存在 | 40400 | "主题帖不存在" |
| 取消订阅不存在 | 40400 | "订阅不存在" |
