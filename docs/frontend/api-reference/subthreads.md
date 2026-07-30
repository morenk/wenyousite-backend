# API 速查：子贴（Subthreads）

> 主题帖内的子版块管理。详细用户旅程见 `../user-journeys/post-and-reply.md`。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/threads/:threadId/subthreads` | Public | 子贴列表 |
| POST | `/threads/:threadId/subthreads` | Auth | 创建子贴 |
| GET | `/subthreads/:id` | Public | 子贴详情 |
| PATCH | `/subthreads/:id` | Auth | 修改子贴 |
| DELETE | `/subthreads/:id` | Auth | 软删除子贴 |
| PUT | `/threads/:threadId/subthreads/reorder` | Auth | 批量重排 |
| GET | `/subthreads/:subthreadId/tags` | Public | 子贴标签列表 |
| POST | `/subthreads/:subthreadId/tags` | Auth | 添加标签 |
| DELETE | `/subthreads/:subthreadId/tags/:tagId` | Auth | 移除标签 |

---

## 创建子贴

```http
POST /api/v1/threads/:threadId/subthreads
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "设定区",
  "sortOrder": 1,
  "postingPolicy": "PARTICIPANTS",
  "content": "这里是子贴正文..."
}
```

### 字段

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| title | string | 是 | — | 子贴标题 |
| sortOrder | number | 否 | 自动递增 | 排序值 |
| postingPolicy | enum | 否 | `PARTICIPANTS` | 发帖权限策略 |
| content | string | 否 | 空 | 子贴首楼正文 |

### 权限

- 仅 `OWNER` 和 `COLLABORATOR` 可创建子贴。

### 响应

```json
{
  "code": 0,
  "data": {
    "id": "s1",
    "title": "设定区",
    "sortOrder": 1,
    "postingPolicy": "PARTICIPANTS",
    "bodyPostId": "p1",
    "posts": [...],
    "threadId": "t1"
  }
}
```

---

## 获取子贴列表

```http
GET /api/v1/threads/:threadId/subthreads
Authorization: Bearer <accessToken>   // 未登录也可访问 PUBLIC 帖
```

**响应**：按 `sortOrder` 升序排列的子贴列表，不含正文。

---

## 修改子贴

```http
PATCH /api/v1/subthreads/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "新的标题",
  "postingPolicy": "COLLABORATORS",
  "version": 1
}
```

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 否 | 标题 |
| postingPolicy | enum | 否 | 发帖权限策略 |
| version | number | 是 | 乐观锁版本 |

### 注意

- 默认子贴的 `sortOrder` 不可修改（始终为 0）。
- 使用乐观锁 `version`。

---

## 删除子贴

```http
DELETE /api/v1/subthreads/:id
Authorization: Bearer <accessToken>
```

- 软删除（`deletedAt` 标记）。
- 默认子贴不可单独删除（需删除整个主题帖）。
- 仅 `OWNER` 和 `COLLABORATOR` 可删除。

---

## 批量重排子贴

```http
PUT /api/v1/threads/:threadId/subthreads/reorder
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "ids": ["defaultSubthreadId", "s2", "s3", "s1"]
}
```

### 规则

- 传入按目标顺序排列的子贴 ID 数组。
- 第一个 ID 必须是默认子贴。
- 后端会按数组顺序重新分配 `sortOrder`。

### 前端交互

- 支持拖拽排序。
- 拖拽结束后一次性调用该接口。
- 重排失败时回退到原顺序。

---

## PostingPolicy 说明

| 值 | 可发帖人群 |
|----|-----------|
| `PARTICIPANTS` | 所有帖内成员（默认） |
| `COLLABORATORS` | 仅 OWNER 和 COLLABORATOR |
| `PLAYERS` | 仅被标记为玩家的成员 |

---

## 子贴标签

### 获取标签列表

```http
GET /api/v1/subthreads/:subthreadId/tags
```

### 添加标签

```http
POST /api/v1/subthreads/:subthreadId/tags
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "剧透",
  "color": "#FF0000"
}
```

### 移除标签

```http
DELETE /api/v1/subthreads/:subthreadId/tags/:tagId
Authorization: Bearer <accessToken>
```

---

## 前端实现建议

### 主题帖详情页子贴目录

- 在主题帖详情页右侧或顶部显示子贴目录。
- 点击目录项滚动到对应子贴内容区。
- 默认子贴通常排在第一位。

### 创建子贴入口

- 仅楼主/协作者可见"添加子贴"按钮。
- 创建子贴时可同时填写首楼正文。

### 排序交互

- Web 端：拖拽手柄。
- 移动端：长按拖拽或上下箭头按钮。

### 发帖权限提示

- 当用户没有发帖权限时，隐藏回复框或显示"该子贴仅限协作者/玩家发帖"。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 无创建权限 | 40300 | "仅楼主/协作者可创建子贴" |
| 默认子贴不可删除 | 40300 | "默认子贴不可删除" |
| 重排首项非默认子贴 | 40001 | "默认子贴必须排在第一位" |
| 乐观锁冲突 | 40900 | "内容已被修改，请刷新后重试" |
