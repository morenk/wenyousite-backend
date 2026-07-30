# 用户旅程：发帖与回复

> 在已创建的主题帖（草稿或已发布）中，创建子贴、发布楼层、回复楼层、使用 @提及。

## AI 执行摘要

- **涉及页面**：主题帖详情页 / 子贴详情页 / 回复页
- **涉及接口**：
  - 子贴：`POST /threads/:id/subthreads`、`GET /subthreads/:id`
  - 楼层：`POST /subthreads/:id/posts`、`GET /subthreads/:id/posts`、`PATCH /posts/:id`、`DELETE /posts/:id`
  - 楼中楼：`POST /posts/:id/replies`
- **关键状态**：楼层编号 `floorNumber`、发帖权限策略 `postingPolicy`
- **常见错误**：`40300` 无发帖权限、`40001` 内容为空

---

## 核心关系

```
Thread
 └── Subthread（子贴，含 postingPolicy）
      └── Post（楼层）
           └── Post（楼中楼回复，parentPostId 指向被回复楼层）
```

- 每个 `Post` 必须属于一个 `Subthread`。
- 楼中楼回复不是嵌套结构，而是平级挂在同一个 `parentPostId` 下。
- 回复目标通过 `replyToPostId` 追踪。

---

## 创建子贴

### 接口

```http
POST /api/v1/threads/:id/subthreads
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "设定区",
  "sortOrder": 1,
  "postingPolicy": "PARTICIPANTS",
  "content": "这里是子贴正文..."
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| title | 是 | 子贴标题 |
| sortOrder | 否 | 排序，默认自动递增 |
| postingPolicy | 否 | 发帖权限策略，默认 `PARTICIPANTS` |
| content | 否 | 子贴首楼正文。不传则只创建空子贴 |

### postingPolicy 说明

| 值 | 可发帖人群 |
|----|-----------|
| `PARTICIPANTS` | 所有帖内成员（默认） |
| `COLLABORATORS` | 仅 OWNER 和 COLLABORATOR |
| `PLAYERS` | 仅被标记为玩家的成员 |

### 权限

- 草稿态：只有 OWNER/COLLABORATOR 能创建子贴。
- 已发布态：同样只有 OWNER/COLLABORATOR 能创建子贴。

---

## 在子贴下发布楼层

### 接口

```http
POST /api/v1/subthreads/:id/posts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "content": "我支持这个观点...",
  "parentPostId": null,
  "replyToPostId": null
}
```

### 响应

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "floorNumber": 2,
    "content": "我支持这个观点...",
    "author": { ... },
    "createdAt": "..."
  }
}
```

### 楼层编号规则

- 每个子贴内独立编号，从 1 开始。
- 子贴首楼（创建子贴时传的 content）floorNumber = 1。
- 楼中楼回复 floorNumber = null。
- 编号永不复用，删除楼层后也不会回退。

---

## 楼中楼回复

### 接口

```http
POST /api/v1/subthreads/:id/posts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "content": "@张三 你说得对",
  "parentPostId": "被回复楼层的postId",
  "replyToPostId": "被回复楼层的postId"
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `parentPostId` | 被回复楼层 ID，表示这是一个楼中楼回复 |
| `replyToPostId` | 具体回复目标楼层 ID。平级回复中可能与 parentPostId 相同 |

### 获取楼中楼列表

调用：

```http
GET /api/v1/subthreads/:id/posts?parentPostId=xxx&limit=20
```

或在子贴详情页通过 `GET /subthreads/:id/posts` 获取全部楼层（含楼中楼）。

---

## 编辑帖子

### 接口

```http
PATCH /api/v1/posts/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "content": "修改后的内容",
  "version": 1
}
```

- 只能编辑自己发的帖子（OWNER 可编辑所有人的帖子）。
- 使用乐观锁 `version`。

---

## 删除帖子

### 接口

```http
DELETE /api/v1/posts/:id
Authorization: Bearer <accessToken>
```

- 帖子为软删除（`deletedAt` 标记）。
- 删除后楼层编号保留，内容显示为"已删除"。

---

## @提及

### 规则

1. 内容中用 `@username` 格式提及用户。
2. 服务端在 `post.created` 事件触发时解析 @提及。
3. **草稿内的帖子不会立即触发通知**，会在发布时统一回放。

### 谁能@谁

| 场景 | 规则 |
|------|------|
| 已关注 | 已关注目标用户 → 可 @ |
| 同帖玩家 | 同在一个 Thread 的玩家之间 → 可 @ |
| 玩家→楼主 | 玩家可以 @ 楼主 |
| 楼主→任何人 | 楼主可以 @ 任何人 |
| @自己 | 不发送通知 |

### 前端处理

- 输入 `@` 时弹出用户搜索建议。
- 建议候选：当前帖成员、已关注用户。
- 最终发送的 content 中保留 `@username` 纯文本。

---

## 草稿态 vs 已发布态的发帖差异

| 行为 | 草稿态 | 已发布态 |
|------|--------|----------|
| 创建子贴 | 允许，仅 OWNER/COLLABORATOR | 允许，仅 OWNER/COLLABORATOR |
| 发布楼层 | 允许，按 postingPolicy | 允许，按 postingPolicy |
| 触发通知 | 否 | 是 |
| 触发 @提及通知 | 否（发布时回放） | 是 |

---

## 全局草稿池的使用

主题帖沙盒草稿和全局 5 槽位草稿池是两套系统：

- **沙盒草稿**：用于创建主题帖的整个生命周期。
- **全局草稿池**：用于临时保存某一段回复/正文，不与任何子贴绑定。

全局草稿池的典型场景：
- 用户在帖子 A 写了一半回复，临时切到帖子 B，可以把帖子 A 的回复存到草稿池。
- 用户在编辑器里写长文，担心丢失，手动保存到草稿池。

**前端不要把主题帖创建流程的自动保存混用为全局草稿池。**
