# 用户旅程：用户资料、关注与拉黑

> 用户个人资料、他人资料页、关注/取消关注、拉黑/取消拉黑、隐私开关。

## AI 执行摘要

- **涉及页面**：我的资料页 / 用户资料页 / 关注列表 / 粉丝列表 / 黑名单 / 用户搜索
- **涉及接口**：
  - 资料：`GET /users/me`、`PATCH /users/me`、`PATCH /users/me/avatar`、`GET /users/:id`
  - 社交：`POST /users/follow/:id`、`DELETE /users/follow/:id`、`GET /users/following`、`GET /users/followers`
  - 拉黑：`POST /users/me/block/:id`、`DELETE /users/me/block/:id`、`GET /users/me/blocks`
  - 搜索：`GET /users/search?q=`
- **关键状态**：关注关系、拉黑关系、隐私开关
- **常见错误**：`40300` 需邮箱验证、`40100` 未登录

---

## 用户资料

### 获取本人完整资料

```http
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```

**响应关键字段**：

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "email": "user@example.com",
    "username": "zhangsan",
    "avatar": "https://...",
    "bio": "...",
    "role": "USER",
    "emailVerified": true,
    "showRecentReplies": true,
    "showPlayerBadges": true,
    "showBookmarks": true,
    "createdAt": "...",
    "updatedAt": "...",
    "_count": {
      "following": 10,
      "followers": 100
    }
  }
}
```

### 修改本人资料

```http
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "username": "zhangsan_new",
  "bio": "新的简介",
  "showRecentReplies": true,
  "showPlayerBadges": false,
  "showBookmarks": true
}
```

**注意**：
- 用户名修改需间隔 7 天以上。
- 头像需通过 `PATCH /users/me/avatar` 单独设置。
- 修改资料需要邮箱已验证（`@Auth()` 守卫）。

### 设置头像

```http
PATCH /api/v1/users/me/avatar
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "mediaId": "clx..."
}
```

`mediaId` 来自图片上传流程（详见 `user-journeys/image-upload.md`）。

### 查看他人公开资料

```http
GET /api/v1/users/:id
Authorization: Bearer <accessToken>   // 可选，登录后才有关系字段
```

**未登录响应**：仅含公开字段。

**登录后响应**：额外返回：

```json
{
  "isFollowing": true,
  "isFollowedBy": false,
  "isBlocked": false,
  "isBlockedBy": false
}
```

### 已注销用户

如果用户已注销，公开资料会被屏蔽为：

```json
{
  "id": "clx...",
  "username": "已注销用户",
  "isDeactivated": true
}
```

---

## 关注与粉丝

### 关注用户

```http
POST /api/v1/users/follow/:id
Authorization: Bearer <accessToken>
```

### 取消关注

```http
DELETE /api/v1/users/follow/:id
Authorization: Bearer <accessToken>
```

### 我的关注列表

```http
GET /api/v1/users/following
Authorization: Bearer <accessToken>
```

### 我的粉丝列表

```http
GET /api/v1/users/followers
Authorization: Bearer <accessToken>
```

### 关注规则

- 不能关注自己。
- 首次关注时会发送 follow 通知给被关注者。
- 重复关注幂等，不会重复通知。
- 关注和取消关注需要邮箱已验证（`@Auth()`）。

---

## 拉黑

### 拉黑用户

```http
POST /api/v1/users/me/block/:id
Authorization: Bearer <accessToken>
```

### 取消拉黑

```http
DELETE /api/v1/users/me/block/:id
Authorization: Bearer <accessToken>
```

### 我的黑名单

```http
GET /api/v1/users/me/blocks
Authorization: Bearer <accessToken>
```

### 拉黑影响

拉黑是双向阻止：

| 场景 | 效果 |
|------|------|
| 被拉黑者不能在被拉黑者的帖子下发帖 | 发帖/回复被拦截 |
| 拉黑者不会收到被拉黑者的通知 | 不触发 @提及通知 |
| 拉黑者的帖子对被拉黑者不可见 | 列表/详情过滤 |

前端提示：拉黑成功后，相关页面应立即移除对方内容。

---

## 用户搜索

主要用于 @提及 场景下的用户搜索：

```http
GET /api/v1/users/search?q=zhang
Authorization: Bearer <accessToken>
```

**响应**：最多 10 条匹配结果。

```json
{
  "code": 0,
  "data": [
    { "id": "clx...", "username": "zhangsan", "avatar": "..." },
    { "id": "clx...", "username": "zhangsanfeng", "avatar": "..." }
  ]
}
```

---

## 隐私开关

三个隐私开关控制他人是否能看到你的内容：

| 开关 | 默认值 | 关闭时的影响 |
|------|--------|-------------|
| `showRecentReplies` | `true` | 他人无法通过 `GET /users/:id/recent-replies` 查看你的最近 10 条回复 |
| `showPlayerBadges` | `true` | 他人无法通过 `GET /users/:id/played-threads` 查看你参与的主题帖 |
| `showBookmarks` | `true` | 他人无法通过 `GET /users/:id/bookmarks` 查看你的收藏 |

**本人始终可见自己的内容**，即使关闭开关。

---

## 前端实现建议

### 用户资料页

- 未登录：显示公开资料，不显示关注/拉黑按钮。
- 登录后：显示 `isFollowing`、`isBlocked` 等按钮状态。
- 自己的资料页：显示"编辑资料"入口。

### 关注/拉黑按钮

```typescript
// 资料页按钮状态
if (isBlocked) {
  buttonText = '已拉黑';
  buttonAction = unblockUser;
} else if (isFollowing) {
  buttonText = '已关注';
  buttonAction = unfollowUser;
} else {
  buttonText = '关注';
  buttonAction = followUser;
}
```

### 关注/粉丝列表

- 点击用户头像或用户名进入用户资料页。
- 登录用户可一键取关/关注。

### 黑名单

- 显示拉黑用户列表。
- 提供"取消拉黑"按钮。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 未登录查看需登录内容 | 40100 | 跳转登录 |
| 邮箱未验证修改资料 | 40300 | "请先验证邮箱" |
| 用户名修改间隔不足 | 40001 | 提示剩余天数 |
| 用户名已被占用 | 40900 | "用户名已被占用" |
| 关注自己 | 40001 | "不能关注自己" |
| 拉黑自己 | 40001 | "不能拉黑自己" |

---

## 状态机

```
[用户 A 查看用户 B 资料]
        │
        ├─ 未登录 ──> 仅公开资料
        │
        └─ 已登录 ──> 公开资料 + isFollowing/isBlocked 等关系
        │
        ▼
   [关注/取消关注/拉黑/取消拉黑]
        │
        ▼
   [更新按钮状态 + 发送通知（首次关注）]
```
