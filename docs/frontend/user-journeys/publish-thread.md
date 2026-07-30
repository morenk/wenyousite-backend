# 用户旅程：发布主题帖

> 从草稿状态到正式发布，包括发布校验、乐观锁处理、发布成功后的跳转和通知。

## AI 执行摘要

- **涉及页面**：创建主题帖页 / 草稿箱页 / 主题帖详情页
- **涉及接口**：`PATCH /threads/:id`、`GET /threads/:id`
- **关键状态**：`published=false` → `published=true`
- **常见错误**：`40001` 缺少标题/分类/正文、`40900` 乐观锁冲突/重复发布

---

## 发布流程

```
用户点击"发布"按钮
        ↓
前端调用 GET /threads/:id 获取最新 version（如果本地 version 可能过期）
        ↓
前端调用 PATCH /threads/:id
{
  "published": true,
  "version": <当前version>
}
        ↓
后端校验：
  1. title 非空且不是"未命名草稿"
  2. category 已设置
  3. 默认子贴存在且有正文
        ↓
校验通过 → published=true，通知粉丝，回放 @提及
        ↓
前端跳转到主题帖详情页 /threads/:id
```

---

## 接口调用

### 获取最新 version

在发布前，建议先获取一次主题帖详情，确保本地 `version` 是最新的：

```http
GET /api/v1/threads/:id
Authorization: Bearer <accessToken>
```

响应中包含 `version` 字段。

### 发布请求

```http
PATCH /api/v1/threads/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "published": true,
  "version": 1
}
```

如果用户同时修改了标题、分类等信息，可以一起带上：

```http
PATCH /api/v1/threads/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "最终标题",
  "category": "RPG",
  "visibility": "PUBLIC",
  "published": true,
  "version": 1
}
```

**注意**：
- `published` 必须为 `true` 才能触发发布。
- `version` 必填，且必须等于当前 Thread 的 version。
- 只有 `OWNER` 或 `COLLABORATOR` 可以发布。

### 发布成功响应

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "title": "最终标题",
    "published": true,
    "publishedAt": "2026-07-30T08:30:00.000Z",
    "version": 2,
    ...
  }
}
```

### 发布失败响应示例

```json
{
  "code": 40001,
  "message": "请填写主题帖标题后再发布",
  "data": null
}
```

```json
{
  "code": 40001,
  "message": "请选择分区后再发布",
  "data": null
}
```

```json
{
  "code": 40001,
  "message": "请将子贴至少填写正文再发布",
  "data": null
}
```

```json
{
  "code": 40900,
  "message": "主题帖已被修改，请刷新后重试",
  "data": null
}
```

---

## 发布校验规则

后端在 `published=true` 时会严格校验：

| 校验项 | 要求 | 失败提示 |
|--------|------|----------|
| title | 非空，且不能是 `"未命名草稿"` | "请填写主题帖标题后再发布" |
| category | 已设置 | "请选择分区后再发布" |
| 默认子贴 | 存在 | "请至少创建一个子贴后再发布" |
| 默认子贴正文 | 有 bodyPostId 或至少一个 post | "请将子贴至少填写正文再发布" |

**前端建议**：在发布按钮点击前做本地预校验，避免用户点击后才发现缺内容。但后端校验是最终防线。

---

## 乐观锁处理

Thread 使用乐观锁 `version` 字段防止并发修改。

### 正常流程

```
version=1  ──GET /threads/:id──>  前端持有 version=1
            ──PATCH { version: 1 }──>  后端 version 加 1
            ──响应──>  version=2
```

### 冲突场景

```
用户 A GET /threads/:id  version=1
用户 B PATCH /threads/:id version=1 成功，version 变为 2
用户 A 仍用 version=1 调 PATCH
        ↓
后端返回 40900 "主题帖已被修改，请刷新后重试"
```

### 前端处理

1. **发布前刷新**：调 `GET /threads/:id` 拿最新 `version`。
2. **冲突后提示**：显示"内容已被其他设备修改，请刷新后重试"。
3. **不要自动重试**：避免覆盖他人修改。

---

## 发布后的副作用

发布成功后，后端会：

1. **回放草稿期事件**：遍历草稿内的所有帖子，补发射 `post.created` 事件，触发 @提及解析和通知。
2. **通知粉丝**：给创建者的所有粉丝发送 `thread_created` 类型通知。
3. **维护 Redis 排序**：把帖子加入推荐/活跃/最新 ZSET。
4. **缓存失效**：使 Thread 详情和列表缓存失效。

这些对前端是透明的，前端只需要：
- 跳转详情页
- 提示"发布成功"

---

## 前端交互建议

### 发布按钮状态

- 标题为空或仍是"未命名草稿"：按钮可点击，但点击后提示"请填写标题"。
- 分类未选：提示"请选择分区"。
- 默认子贴无正文：提示"请至少填写一段正文"。
- 全部满足：按钮高亮，点击后进入 loading 态。

### 发布中

显示 loading，禁用发布按钮，防止重复提交。

### 发布成功

```
Toast: "发布成功"
跳转: /threads/:id
```

### 发布失败

根据 `code` 和 `message` 显示对应提示：
- `40001` → 按 message 提示缺什么内容
- `40900` → "内容已被修改，请刷新后重试"
- `40100` / `40300` → 跳转登录或提示无权限

---

## 移动端与 Web 端差异

| 场景 | 移动端建议 | Web 端建议 |
|------|-----------|-----------|
| 发布入口 | 编辑器顶部固定"发布"按钮 | 顶部工具栏 + Ctrl+Enter 快捷键 |
| 校验提示 | Toast + 滚动到错误字段 | 表单下方 inline error |
| 发布成功跳转 | 详情页，返回按钮回到首页 | 详情页，保留面包屑 |
| 长文编辑 | 简化编辑器，分段预览 | 完整 Markdown 编辑器，双栏预览 |

---

## 状态机补充

```
[草稿态]
   │
   │ 用户点击发布
   ▼
[获取最新 version]
   │
   ▼
[PATCH published=true]
   │
   ├─ 校验失败 → 提示错误，返回草稿态
   │
   └─ 校验通过 → 已发布态
            │
            ▼
      [跳转详情页]
            │
            ▼
      [显示发布成功提示]
```
