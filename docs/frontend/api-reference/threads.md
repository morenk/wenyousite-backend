# API 速查：主题帖（Threads）

> 前端调用主题帖相关接口的快速参考。详细业务规则见 `../user-journeys/create-thread.md` 和 `../user-journeys/publish-thread.md`。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| GET | `/threads/draft` | AuthRead | 我的草稿箱 |
| POST | `/threads` | Auth | 创建主题帖草稿 |
| GET | `/threads` | Public | 主题帖列表（仅已发布） |
| GET | `/threads/:id` | AuthRead | 主题帖详情 |
| PATCH | `/threads/:id` | Auth | 修改/发布主题帖 |
| DELETE | `/threads/:id` | Auth | 删除主题帖 |
| POST | `/threads/:id/like` | Auth | 点赞 |
| DELETE | `/threads/:id/like` | Auth | 取消点赞 |
| POST | `/threads/:id/invite-link` | Auth | 生成私密帖邀请链接 |
| GET | `/threads/join-by-link/:token` | AuthRead | 预览邀请链接 |
| POST | `/threads/join-by-link/:token` | Auth | 通过邀请链接加入 |

---

## GET /threads/draft

获取当前用户所有 `published=false` 的主题帖草稿。

### 响应

```json
{
  "code": 0,
  "data": [
    {
      "id": "clx...",
      "title": "未命名草稿",
      "published": false,
      "createdAt": "...",
      "updatedAt": "...",
      "defaultSubthread": { "id": "clx...", "title": "未命名草稿" },
      "topicTags": [],
      "_count": { "subthreads": 1, "posts": 0 }
    }
  ]
}
```

### 前端展示要点

- 标题为空时显示 `"未命名草稿"`。
- 显示 `_count.subthreads` 和 `_count.posts`。
- 提供"继续编辑"和"删除"按钮。

---

## POST /threads

创建主题帖草稿。所有字段可选。

### 请求

```json
{
  "title": "我的主题帖",
  "category": "RPG",
  "visibility": "PUBLIC",
  "subthreadTitle": "主帖",
  "content": "这里是开场白...",
  "tagNames": ["无限流", "穿越"]
}
```

### 字段

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| title | string | 否 | `"未命名草稿"` | 主题帖标题 |
| category | enum | 否 | `"DEDUCTION"` | `DEDUCTION` / `NATION` / `RPG` |
| visibility | enum | 否 | `"PUBLIC"` | `PUBLIC` / `PRIVATE` |
| subthreadTitle | string | 否 | 同 title | 默认子贴标题 |
| content | string | 否 | 空 | 默认子贴首楼正文 |
| tagNames | string[] | 否 | [] | 主题帖标签 |

### 响应关键字段

- `id`：threadId
- `defaultSubthreadId`：默认子贴 ID
- `version`：乐观锁版本号
- `published`：false

---

## GET /threads

主题帖列表，仅返回 `published=true`。

### Query 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| sort | string | `recommended` / `newest` / `active`，默认 `recommended` |
| category | string | 按分区筛选 |
| tag | string | 按标签名筛选 |
| filter | string | `all`（默认，仅 PUBLIC）/ `playing`（我参与的，含私密帖） |
| cursor | string | 游标，首页不传 |
| limit | number | 默认 20，最大 50 |

### 分页说明

- `newest` / `active`：ID cursor。
- `recommended`：偏移量 cursor（数字字符串）。

### 响应

```json
{
  "code": 0,
  "data": [ ... ],
  "meta": { "cursor": "...", "hasMore": true }
}
```

### 列表项字段

每个 item 含 `preview` 字段（默认子贴首楼正文截断后的纯文本，约 100 字）。

---

## GET /threads/:id

主题帖详情。

### 权限

- 已发布 PUBLIC：任何人可读。
- 已发布 PRIVATE：仅成员可读，非成员返回 404。
- 未发布：仅 owner 可读，非 owner 返回 404。

### 响应

包含完整 Thread 对象、owner、全部 subthreads、topicTags、`_count`。

---

## PATCH /threads/:id

修改主题帖，设置 `published=true` 即发布。

### 请求

```json
{
  "title": "最终标题",
  "category": "RPG",
  "visibility": "PUBLIC",
  "published": true,
  "version": 1
}
```

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 否 | 标题 |
| category | enum | 否 | 分区 |
| status | enum | 否 | `RECRUITING` / `CLOSED` / `FINISHED` |
| visibility | enum | 否 | 可见性 |
| published | boolean | 否 | 设为 true 发布 |
| version | number | **是** | 乐观锁版本号 |

### 错误码

- `40001`：发布校验失败（缺标题/分类/正文）或已发布帖重复发布。
- `40900`：乐观锁冲突或重复发布。
- `40300`：无管理权限。

---

## DELETE /threads/:id

删除主题帖。

- 未发布帖：硬删除（级联）。
- 已发布帖：仅 OWNER 可软删除。

---

## 枚举中文

### ThreadCategory

| 值 | 中文含义 | 适用场景 |
|----|---------|---------|
| `DEDUCTION` | 推理 | 剧本杀、海龟汤、解谜 |
| `NATION` | 国策 | 国家/文明模拟 |
| `RPG` | 角色扮演 | 跑团、文字 RPG |

### ThreadVisibility

| 值 | 含义 |
|----|------|
| `PUBLIC` | 公开，所有人可见 |
| `PRIVATE` | 私密，仅成员可见 |

### ThreadStatus

| 值 | 含义 |
|----|------|
| `RECRUITING` | 招募中 |
| `CLOSED` | 已截止 |
| `FINISHED` | 已完结 |
