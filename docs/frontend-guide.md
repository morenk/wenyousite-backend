# 温油站 — 前端接入指南

> 面向前端 / Flutter / React 开发者的 API 对接文档。
> Swagger 文档：开发环境 `http://localhost:3000/api/docs`，按端点查阅请求/响应 Schema。
> 本文档提供 Swagger 不易表达的：认证流程、分页约定、关键业务规则、错误码速查。

---

## 1. 基础约定

| 项目 | 值 |
|------|-----|
| API 前缀 | `/api/v1` |
| 开发环境 | `http://localhost:3000/api/v1` |
| 生产环境 | `https://wenyou.site/api/v1` |
| 请求格式 | `Content-Type: application/json` |
| 字符编码 | UTF-8 |

### 1.1 统一响应格式

所有成功和失败响应均为 `{ code, message, data, meta? }` 结构：

Swagger `/api/docs-json` 同样输出这一真实 envelope，可直接用于 Web/Flutter 客户端生成；生成模型中的业务对象位于 `data`，分页信息位于 `meta`。

**成功（单对象）**
```json
{ "code": 0, "message": "ok", "data": { ... } }
```

**分页成功**
```json
{
  "code": 0, "message": "ok",
  "data": [ ... ],
  "meta": { "cursor": "clx...", "hasMore": true }
}
```

**业务异常**
```json
{ "code": 40001, "message": "请在子贴中至少撰写一个楼层后再发布", "data": null }
```

**校验失败**
```json
{ "code": 40000, "message": "title must be shorter than or equal to 100 characters", "data": null }
```

### 1.2 错误码速查

| code | 含义 | 典型场景 |
|------|------|----------|
| `0` | 成功 | — |
| `40000` | 参数校验失败 | 字段长度/格式不符合 DTO |
| `40001` | 业务逻辑错误 | 缺少必填内容、数据不完整 |
| `40003` | 骰子表达式非法 | 不是 NdM±K 或数量/面数/修正值超限 |
| `40004` | 骰子次数超限 | 单帖正式结果与本次新增合计超过 20 |
| `40100` | 未登录 | Token 缺失或无效 |
| `40300` | 权限不足 | 非 OWNER 修改、非协作者发帖 |
| `40400` | 资源不存在 | 帖/子贴/用户/通知不存在 |
| `40401` | 私密帖不可访问 | PRIVATE 帖非成员 |
| `40900` | 冲突 | 重复收藏、用户名占用、乐观锁冲突 |
| `42900` | 限流 | 超过频率限制 |
| `50000` | 服务器错误 | 内部异常 |

---

## 2. 认证 (Auth)

### 2.1 认证流程

```
注册: request-code → verify-and-complete → 建立对应端登录终端
登录: login → 建立对应端登录终端
使用: 所有请求带 Authorization: Bearer <accessToken>
刷新: accessToken 过期 → refresh → 轮转 Token
登出: logout（退出当前登录终端）
```

### 2.2 Token 说明

| Token | 有效期 | 存储方式 | 用途 |
|-------|--------|----------|------|
| `accessToken` | 15 分钟 | 前端内存/localStorage | 请求时放 `Authorization: Bearer <token>` |
| `refreshToken` | web 7 天 / mobile 30 天 | Web：仅 httpOnly Cookie；原生移动端：仅响应体 | 刷新 accessToken |

**双端登录**：每个账号最多一个 Web 登录终端和一个原生移动端登录终端。PC 与手机浏览器均属 Web 端；同端再次登录会替换旧终端。Web 的 refresh 和 logout 自动从 Cookie 读取 refreshToken，RequestBody 仅作兼容备选。

### 2.3 登录示例

```
POST /api/v1/auth/login
Content-Type: application/json
X-Client-Platform: web

{ "account": "user@example.com 或 zhangsan", "password": "SecurePass123!" }
```

**成功响应 (200)**：
```json
{
  "code": 0, "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "clxabc123...",
      "email": "user@example.com",
      "username": "zhangsan",
      "avatar": "https://...",
      "role": "USER",
      "emailVerified": true
    }
  }
}
```

### 2.4 刷新 Token

```
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "a1b2c3d4-..." }   // Cookie 中有则可不传
```

Web 成功响应只返回新的 access token 与 user，新 refresh token 通过 httpOnly Cookie 写入；原生移动端响应体还会返回新 refresh token。平台沿用服务端登录终端记录，旧 refresh token 立即失效。

---

## 3. 分页 (Cursor Pagination)

所有列表类端点（threads / posts / notifications / bookmarks 等）使用 **游标分页**（id-based cursor）。

### 3.1 请求

| 参数 | 类型 | 说明 |
|------|------|------|
| `cursor` | string | 上一页最后一条记录的 ID。**首次请求不传** |
| `limit` | number | 每页条数，默认 20，最大 50 |

### 3.2 响应

```json
{
  "code": 0, "message": "ok",
  "data": [ ... ],
  "meta": { "cursor": "clx...last", "hasMore": true }
}
```

- `meta.cursor`：当前页最后一条记录的 ID。**原样传给下一页的 `?cursor=`**
- `meta.hasMore`：`true` 有下一页，`false` 已到末尾

### 3.3 前端伪代码

```js
let cursor = null;
let hasMore = true;
while (hasMore) {
  const params = { limit: 20 };
  if (cursor) params.cursor = cursor;
  const res = await fetch(`/api/v1/threads?${new URLSearchParams(params)}`);
  const { data, meta } = await res.json();
  items.push(...data);
  cursor = meta.cursor;
  hasMore = meta.hasMore;
}
```

### 3.4 智能排序 special case

`GET /threads?sort=recommended` 使用 **偏移量分页**（不是 ID-cursor）。`cursor` 传整数字符串偏移量：

```js
// 智能排序首页
GET /threads?sort=recommended&limit=20  → meta.cursor: "20"
// 第二页
GET /threads?sort=recommended&limit=20&cursor=20 → meta.cursor: "40"
```

---

## 4. 核心业务流程

### 4.1 创建并发布主题帖

```
1. POST /threads               创建草稿（published=false）
   → 返回 threadId
2. POST /threads/:id/subthreads  创建子贴（含正文 content）
   → 自动创建 floorNumber=1 的楼层
3. POST /subthreads/:id/posts   追加楼层（可选，在子贴下）
4. PATCH /threads/:id          设置 published=true 发布
   → 校验 title/category/含正文子贴，通知粉丝
```

**创建草稿请求**：
```json
{
  "title": "我的主题帖",
  "category": "RPG",
  "tagNames": ["无限流", "穿越"],
  "visibility": "PUBLIC"
}
```

**创建子贴（含正文）请求**：
```json
{
  "title": "设定区",
  "content": "这里是世界观设定...（支持 Markdown）",
  "postingPolicy": "PARTICIPANTS"
}
```

**发布请求**：
```json
{
  "published": true,
  "version": 1
}
```

### 4.2 浏览子贴楼层

```
GET /subthreads/:id/posts?limit=20
```

每个楼层对象包含：
- 楼层基础字段（floorNumber、content、author、createdAt）
- `_count.replies`：该楼层总的楼中楼回复数
- `replies`：前 5 条楼中楼回复的内嵌数组（含 author / replyToPost）
- 如果 `_count.replies > 5`，前端应显示"查看全部 N 条回复"入口

### 4.3 楼中楼

```
GET /posts/:id/replies?limit=20    // 获取某楼层的全部回复（分页）
POST /subthreads/:id/posts         // 发楼中楼回复
```

**发楼中楼回复**：
```json
{
  "content": "回复内容...",
  "parentPostId": "clxfloor001...",      // 回复哪个楼层（必填）
  "replyToPostId": "clxreply003..."      // 回复哪条具体回复（可选，追踪用）
}
```

楼中楼是**平级挂载**的——所有回复共享同一个 `parentPostId`，通过 `replyToPostId` 追踪回复目标。前端可据此渲染 @某某 的引用关系。

### 4.4 点赞

```
POST   /posts/:id/like     点赞（幂等，重复点赞不报错）
DELETE /posts/:id/like     取消点赞
```

`likeCount` 在 Post 对象上直接返回，无需额外查询。

### 4.5 私密帖 + 邀请

```
POST   /threads/:id/invite-link   生成邀请链接 → 返回 { threadId, token }
GET    /threads/join-by-link/:token   预览邀请链接 → 返回 { thread: { id, title, category, status, owner, memberCount, createdAt }, alreadyJoined }
POST   /threads/join-by-link/:token   通过 16 位 token 幂等加入私密帖
```

前端收到邀请链接后，先调 `GET` 预览。`alreadyJoined=true` 时直接进入 `/threads/{id}`；否则展示确认页面，用户确认后再调 `POST` 正式加入。POST 使用唯一键 upsert，重复或并发提交都返回现有成员记录。

私密帖 `visibility=PRIVATE` 不在公开列表/搜索中出现。非成员访问详情返回 404。

用户主页 `GET /users/:id/played-threads`：仅返回用户已被授予玩家身份（`playerMarked=true`）的非自建帖子，回复生成的普通成员关系不计入；本人可用 `visibility=PUBLIC|PRIVATE` 分类，查看他人时只返回 PUBLIC 帖。

### 4.6 通知

```
GET    /notifications             通知列表（支持 ?type=mention,reply 过滤）
GET    /notifications/unread      未读通知数 → { count: 5 }
PATCH  /notifications/:id/read    标记单条已读
POST   /notifications/read-all    全部已读
```

每条通知含 `type`、`content`（可读文本）、以及 `postId`/`threadId`/`fromUserId` 导航字段。前端可根据 `type` + 导航字段直接跳转到对应内容。

---

## 5. 图片上传管线

S3 预签名直传，不经过后端中转：

```
1. POST /media/upload-url
   { "filename": "photo.jpg", "contentType": "image/jpeg", "size": 204800 }
   → 返回 { uploadUrl: "https://s3...", mediaId: "clx...", publicUrl: "https://cdn..." }

2. PUT {uploadUrl}                     // 前端直接 PUT 到 S3
   Content-Type: image/jpeg
   Body: <二进制文件>

3. POST /media/upload-done
   { "mediaId": "clx..." }            // 确认上传完成，触发服务端缩略图处理
   → 后台队列生成 300x300 缩略图 + 800px 中图 (WebP)

4. GET /media/:id                     // 轮询处理状态
   → status: UPLOADING → PROCESSING → COMPLETED
```

文件限制：仅允许图片格式（jpg/png/gif/webp/bmp/svg），最大 10MB。

---

## 6. 草稿系统

用户级全局 5 槽位草稿池，不与子贴绑定：

```
GET    /drafts              草稿列表
GET    /drafts/slots        槽位使用情况 → { usedSlots: [1,2,3], maxSlots: 5 }
POST   /drafts             保存草稿（不传 slot 自动选空闲位，满时返回 400）
       { "content": "草稿内容...", "slot": 1 }
PATCH  /drafts/:id         更新草稿
DELETE /drafts/:id         删除草稿
```

---

## 7. 关注 / 拉黑

```
POST   /users/follow/:id      关注用户
DELETE /users/follow/:id      取消关注
POST   /users/me/block/:id    拉黑
DELETE /users/me/block/:id    取消拉黑
```

**拉黑规则**：
- 拉黑者的帖子对被拉黑者不可见
- 被拉黑者的帖子对拉黑者不可见
- 双向不发送通知
- 拉黑后已有通知不删除

---

## 8. 用户隐私

```json
// PATCH /users/me
{
  "showRecentReplies": false,   // 隐藏我的最近回复
  "showPlayerBadges": false,    // 隐藏玩家标记
  "showBookmarks": false        // 隐藏收藏/订阅
}
```

三个隐私开关分别控制 `GET /users/:id` 下的子端点是否对他人可见（自己始终可见）。

---

## 9. 搜索

```
GET /search/threads?q=关键词
GET /search/users?q=关键词
GET /search/posts?q=关键词&cursor=&limit=20
GET /threads/:threadId/search/posts?q=关键词&cursor=&limit=20
```

返回：
```json
{
  "code": 0,
  "data": [ ... ],
  "meta": { "cursor": "...", "hasMore": true } // 仅楼层分页端点
}
```

三个全站分类端点供 Tab 按需请求，避免默认执行正文搜索。楼层关键词至少 2 个字符，每页最多 20 条、每个主题帖最多 3 条，按相关度优先排序；继续加载时透传 `meta.cursor`。用户结果排除已注销账号且不返回邮箱等敏感资料；主题帖与全站正文结果仅搜索已发布的公开帖内容。

帖内楼层端点使用相同的关键词限制、排序和游标协议，但覆盖指定主题帖的全部子贴且不限制结果为 3 条；公开帖允许匿名调用，私密帖仅成员可调用，未发布帖仅楼主可调用。帖子结果的 `parentPostId` 用于区分主楼层与楼中楼并生成精确定位链接。

`GET /search?q=` 聚合响应仍保留用于旧客户端兼容；新客户端不要使用它实现分类 Tab。

---

## 10. 阅读进度

```
GET    /reading-progress                         所有子贴的阅读进度列表
GET    /reading-progress/new-replies?subthreadId=  某子贴的新增回复数
POST   /reading-progress                        记录/更新进度
       { "subthreadId": "...", "postId": "..." }
```

`new-replies` 返回的是**发帖时间晚于你上次访问**的回复数，可作红点/气泡展示。

---

## 11. 前端开发建议

1. **先看 Swagger**：`/api/docs` 有每个端点的请求 Schema（含 example 值）和响应描述，Try it out 可直接调试。
2. **Token 管理**：封装一个 HTTP 拦截器，自动在 401 时调 `/auth/refresh` 刷新。
3. **分页**：列表类用 cursor 游标，第一页不传，后续页传 `meta.cursor`。
4. **乐观锁**：编辑帖子/主题帖时，必须传 `version` 字段（从 GET 详情获得），冲突时 (409) 提示用户刷新。
5. **楼中楼展开**：列表里显示前 5 条 + "查看全部"按钮，点击进入独立楼中楼界面分页加载。
6. **图片上传**：等 `status: COMPLETED` 后再插入 Markdown `![](url)`。
7. **通知轮询**：`GET /notifications/unread` 按业务需要间隔（15-30s 均可），避免过于频繁触发限流。
8. **内容安全**：帖子/子贴/草稿/简介等 content 字段按 **Markdown 原样存储**（后端不做 HTML 转义）。客户端必须在**渲染层**净化：web 端用 react-markdown（默认剥离原始 HTML 标签、拦截危险 URL）；移动端用 markdown 渲染器，若需渲染原始 HTML 则对渲染输出加净化。**禁止在后端把内容当 HTML 转义后再存**（会破坏 markdown，导致 `>` 变成 `&gt;`）。

---

## 12. 废弃/搁置的功能

| 模块 | 状态 | 说明 |
|------|------|------|
| Reports | 已搁置 | 举报端点可调但将在后期重构，前端暂不接入 |
| Admin | 已搁置 | `GET /admin` 仅返回占位 JSON，真实管理功能待开发 |
