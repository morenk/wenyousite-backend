# API 速查：标签（Tags）

> 平台级主题帖标签（TopicTag）与帖内子贴标签（SubthreadTagDef）两套体系。

## 两套标签的区别

| 维度 | 主题帖标签（TopicTag） | 子贴标签（SubthreadTagDef） |
|------|----------------------|---------------------------|
| 作用范围 | 平台全局 | 单个主题帖内 |
| 用途 | 跨帖搜索、筛选 | 帖内子贴分组/标记 |
| 唯一性 | 全局唯一 | 帖内唯一，不同帖可重名 |
| 关联接口 | 创建/编辑主题帖时 `tagNames` | 子贴标签接口 |
| 查询接口 | `GET /tags` | `GET /subthreads/:id/tags` |

---

## 主题帖标签（TopicTag）

### 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/tags?q=` | Public | 搜索标签 |
| GET | `/tags/:id` | Public | 标签详情 |
| POST | `/tags` | Auth | 创建标签 |

### 搜索标签

```http
GET /api/v1/tags?q=无限
```

**响应**：

```json
{
  "code": 0,
  "data": [
    { "id": "tag1", "name": "无限流", "color": "#FF5722" },
    { "id": "tag2", "name": "无限恐怖", "color": null }
  ]
}
```

不传 `q` 时返回全部标签。

### 创建标签

```http
POST /api/v1/tags
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "新标签",
  "color": "#2196F3"
}
```

### 标签名规则

- 1-20 字符
- 允许字母、数字、下划线、中文、井号 `#`
- 全局唯一

### 在创建主题帖时使用

```http
POST /api/v1/threads
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "我的主题帖",
  "tagNames": ["无限流", "穿越"]
}
```

后端会自动 `findOrCreate` 这些标签，并建立关联。

---

## 子贴标签（SubthreadTagDef）

子贴标签用于在主题帖内部给子贴分组。接口挂在子贴下：

```http
GET /api/v1/subthreads/:subthreadId/tags
POST /api/v1/subthreads/:subthreadId/tags
DELETE /api/v1/subthreads/:subthreadId/tags/:tagId
```

详见 `subthreads.md`。

---

## 前端实现建议

### 创建主题帖时的标签输入

- 输入标签名时调用 `GET /tags?q=` 做自动补全。
- 允许用户直接输入新标签（创建主题帖时后端会自动创建）。
- 限制标签数量，建议 0-5 个。
- 每个标签以 chip/tag 形式展示，可删除。

### 主题帖列表标签筛选

```http
GET /api/v1/threads?tag=无限流
```

### 标签详情页

点击某个标签可跳转到 `GET /threads?tag=xxx` 的筛选结果页。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 标签名已存在 | 40900 | "该标签已存在" |
| 标签名格式不符 | 40000 | "标签名 1-20 字符，支持中文/字母/数字/下划线/#" |
| 未登录创建标签 | 40100 | 跳转登录 |
