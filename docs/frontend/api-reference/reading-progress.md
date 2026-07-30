# API 速查：阅读进度（Reading Progress）

> 记录用户在每个子贴中的阅读位置，提供新增回复计数。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/reading-progress?subthreadId=` | AuthRead | 查询阅读进度 |
| GET | `/reading-progress/new-replies?subthreadId=` | AuthRead | 新增回复数 |
| POST | `/reading-progress` | AuthRead | 手动更新阅读进度 |

---

## GET /reading-progress

查询指定子贴的阅读进度。

```http
GET /api/v1/reading-progress?subthreadId=s1
Authorization: Bearer <accessToken>
```

不传 `subthreadId` 返回全部子贴的进度。

### 响应

```json
{
  "code": 0,
  "data": {
    "id": "rp1",
    "userId": "u1",
    "subthreadId": "s1",
    "postId": "p5",
    "updatedAt": "..."
  }
}
```

---

## GET /reading-progress/new-replies

查询自上次阅读后，子贴新增了多少回复。

```http
GET /api/v1/reading-progress/new-replies?subthreadId=s1
Authorization: Bearer <accessToken>
```

### 响应

```json
{
  "code": 0,
  "data": {
    "newReplies": 5,
    "totalPosts": 20,
    "continueFrom": {
      "id": "p5",
      "floorNumber": 5
    }
  }
}
```

### 规则

- 从未读过：返回全部楼层数，`continueFrom: null`。
- 读过且记录了 `postId`：以最后阅读帖子的 `createdAt` 为锚点统计。
- 读过但无 `postId`：以进度 `updatedAt` 为锚点统计。

---

## POST /reading-progress

手动更新阅读进度。

```http
POST /api/v1/reading-progress
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "subthreadId": "s1",
  "postId": "p10"
}
```

### 规则

- 每个用户每个子贴最多一条记录，upsert 更新。
- 用户发帖后服务端会自动推进进度，无需客户端调用。

---

## 前端实现建议

### 主题帖列表新增回复提示

在主题帖列表中，对每个子贴调用 `new-replies` 或聚合计算，显示"有 X 条新回复"。

### 继续阅读按钮

```
继续阅读（从 #5 楼）
```

点击后跳转到对应子贴并滚动到 `continueFrom` 帖子。

### 阅读进度自动保存

- 用户滚动到某楼层并停留 3 秒以上，调用 `POST /reading-progress`。
- 离开页面时保存当前最后可见楼层 ID。

### 发帖后自动推进

用户发帖成功后，无需手动调用更新进度接口，服务端已自动处理。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 未登录 | 40100 | 跳转登录 |
| 子贴不存在 | 40400 | "子贴不存在" |
