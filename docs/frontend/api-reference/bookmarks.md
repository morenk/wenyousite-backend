# API 速查：收藏（Bookmarks）

> 用户收藏主题帖，支持公开帖和私密帖（私密帖仅参与人可收藏）。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/bookmarks?cursor=&limit=` | AuthRead | 我的收藏列表 |
| POST | `/bookmarks` | AuthRead | 收藏主题帖 |
| DELETE | `/bookmarks/:id` | AuthRead | 取消收藏 |

---

## GET /bookmarks

获取当前用户的收藏列表，按收藏时间倒序排列。

```http
GET /api/v1/bookmarks?cursor=&limit=20
Authorization: Bearer <accessToken>
```

### 响应

```json
{
  "code": 0,
  "data": [ ... ],
  "meta": { "cursor": "...", "hasMore": true }
}
```

每个收藏记录包含对应的主题帖详情。

---

## POST /bookmarks

收藏主题帖。

```http
POST /api/v1/bookmarks
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "threadId": "t1"
}
```

### 规则

- 公开帖任何人可收藏。
- 私密帖仅参与人可收藏，非参与人返回 404。
- 已收藏的帖重复收藏返回 409 Conflict。

---

## DELETE /bookmarks/:id

取消收藏。

```http
DELETE /api/v1/bookmarks/:id
Authorization: Bearer <accessToken>
```

`:id` 是收藏记录的 ID，不是主题帖 ID。

### 规则

- 只能取消自己的收藏。
- 取消收藏后收藏记录被硬删除。

---

## 前端实现建议

### 主题帖详情页收藏按钮

```typescript
if (isBookmarked) {
  buttonText = '已收藏';
  buttonAction = () => deleteBookmark(bookmarkId);
} else {
  buttonText = '收藏';
  buttonAction = () => createBookmark(threadId);
}
```

### 我的收藏页

- 列表展示收藏的主题帖卡片。
- 支持取消收藏。
- 点击卡片进入主题帖详情。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 未登录 | 40100 | 跳转登录 |
| 重复收藏 | 40900 | "已收藏该主题帖" |
| 私密帖非参与人收藏 | 40400 | "该主题帖不存在或不可收藏" |
| 取消收藏不存在 | 40400 | "收藏记录不存在" |
