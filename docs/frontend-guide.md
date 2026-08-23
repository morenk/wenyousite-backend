# 温油站 — 前端接入指南

> 面向前端 / Flutter / React 开发者的 API 对接文档。
> Swagger 文档：开发环境 `http://localhost:3000/api/docs`，按端点查阅请求/响应 Schema。
> 本文档提供 Swagger 不易表达的认证流程、分页约定、关键业务规则和生成错误码入口。

---

## 1. 基础约定

| 项目     | 值                               |
| -------- | -------------------------------- |
| API 前缀 | `/api/v1`                        |
| 开发环境 | `http://localhost:3000/api/v1`   |
| 生产环境 | `https://wenyou.site/api/v1`     |
| 请求格式 | `Content-Type: application/json` |
| 字符编码 | UTF-8                            |

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

### 1.2 错误码

错误码名称、数值和含义只维护在自动生成的 [`error-codes.md`](./error-codes.md) 与 OpenAPI `BusinessErrorCode` 中。客户端按生成名称分支并保留 unknown fallback，不复制数值表、不使用数值区间，也不依赖 `message` 文案。

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

| Token          | 有效期                  | 存储方式                                                     | 用途                                     |
| -------------- | ----------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `accessToken`  | 15 分钟                 | Web：仅内存；Flutter：系统安全存储                           | 请求时放 `Authorization: Bearer <token>` |
| `refreshToken` | web 7 天 / mobile 30 天 | Web：仅 httpOnly Cookie；Flutter：Keychain/Keystore 安全存储 | 刷新 accessToken                         |

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
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "clxabc123...",
      "email": "user@example.com",
      "username": "zhangsan",
      "avatar": "https://...",
      "role": "USER"
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

所有列表类端点（threads / posts / notifications / bookmarks 等）使用**不透明游标分页**。多数当前实现以 ID 生成游标，推荐排序使用偏移游标，搜索使用编码后的复合游标；客户端不得解析或自行构造。

### 3.1 请求

| 参数     | 类型   | 说明                                                       |
| -------- | ------ | ---------------------------------------------------------- |
| `cursor` | string | 上一页响应的 `meta.cursor`。**首次请求不传，后续原样回传** |
| `limit`  | number | 每页条数，默认 20，最大 50                                 |

### 3.2 响应

```json
{
  "code": 0, "message": "ok",
  "data": [ ... ],
  "meta": { "cursor": "clx...last", "hasMore": true }
}
```

- `meta.cursor`：服务端生成的不透明游标。**原样传给下一页的 `?cursor=`**
- `meta.hasMore`：`true` 有下一页，`false` 已到末尾
- 无法解析、已失效或不属于当前列表的游标返回 HTTP 400 / `code=40007`；客户端应清空列表并从首页重载。

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

### 3.5 按主题帖标签精确筛选

合同 `2.2.0-dev.20260807` 起，标签帖子列表使用稳定的 TopicTag ID：

```http
GET /tags/:id
GET /threads?tagId=:id&sort=recommended&limit=20
```

- `GET /tags/:id` 用于读取标签名称；标签不存在时返回 404。
- `tagId` 对主题帖标签关系做精确匹配，仅返回公开、已发布且未删除的主题帖，可与 `category`、`status`、`sort` 和 cursor 组合。
- 兼容参数 `tag` 仍按标签名称模糊匹配；`tagId` 与 `tag` 同时传入时以 `tagId` 为准。
- 这是向后兼容新增的可选参数，旧 Web/Flutter 客户端无需迁移；新客户端应优先使用 `tagId`，避免同名片段误匹配。

---

## 4. 核心业务流程

### 4.1 创建并发布主题帖

```
1. POST /threads                    创建草稿、OWNER 与默认子贴（published=false）
   → 返回 threadId/defaultSubthreadId/三层 version
2. PATCH /threads/:id/aggregate     原子保存标题/分区/默认正文/标签
3. PATCH /threads/:id/aggregate     同一端点传 published=true 发布
   → 校验 title/category/默认正文，事务内结算骰子并写通知 Outbox
4. POST /threads/:id/subthreads     发布后按需创建其他子贴
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
GET /subthreads/:id/posts?limit=20&order=OLDEST&authorId=<用户ID>
GET /subthreads/:id/posts/authors
```

`order` 可选 `OLDEST | NEWEST`，默认 `OLDEST`；`authorId` 可选，只看当前主题楼主、协作者或已标记玩家创建的主楼层。两者都属于游标分页条件，切换时客户端必须从第一页重新读取。省略 `authorId` 时行为不变；作者筛选不作用于每层内嵌的最早 5 条楼中楼回复。

作者候选接口只返回当前子贴中实际发布过未删除主楼层的楼主、协作者和已标记玩家。候选目录应与楼层首页并行读取，不能从已加载的第一页推导，也不能混入只在其他子贴发言的主题成员。

每个楼层对象包含：

- 楼层基础字段（floorNumber、content、author、createdAt）
- `_count.replies`：该楼层总的楼中楼回复数
- `replies`：前 5 条楼中楼回复的内嵌数组（含 author / replyToPost）
- 如果 `_count.replies > 5`，前端应显示"查看全部 N 条回复"入口

### 4.3 楼中楼

#### 动态评论媒体

`POST /moments/:id/comments` 支持纯文本以及可选的单个媒体位：普通图片传 `mediaId`，收藏表情传 `stickerAssetId`。正文、图片、表情至少提供一项；`mediaId` 与 `stickerAssetId` 不能同时出现。普通图片必须由当前用户上传、已完成处理且尚未绑定其他内容，表情必须仍在当前用户收藏夹中。

评论响应会返回互斥的 `media` / `sticker`；图片或表情评论的 `content` 可以是空字符串，删除后正文和媒体都返回 `null`。旧客户端可忽略新增字段并继续发布纯文字评论。

通知或站内深链接需要定位具体评论时，使用 `GET /moments/:id/comments/:commentId/context`。`commentId` 可以是主评论或楼中楼，响应中的 `root` 用于把回复串注入当前列表，`target` 用于展开、高亮和滚动，`replyCount` 用于保留完整回复计数。目标已删除、因拉黑不可见或不属于该动态时返回 404；不要为定位目标遍历全部评论分页。

```
GET /posts/:id/replies?limit=20&order=OLDEST&authorId=<用户ID> // 获取某楼层的全部回复（分页）
GET /posts/:id/replies/authors                              // 获取该楼层实际回复过的角色作者
POST /subthreads/:id/posts                                  // 发楼中楼回复
```

楼中楼候选接口只统计指定主楼层下未删除回复的作者，并只保留楼主、协作者和已标记玩家；它不会返回主题帖其他楼层的回复者。切换作者或顺序必须清空 cursor 并从第一页重新读取。

**发楼中楼回复**：

```json
{
  "content": "回复内容...",
  "parentPostId": "clxfloor001...", // 回复哪个楼层（必填）
  "replyToPostId": "clxreply003..." // 回复哪条具体回复（可选，追踪用）
}
```

楼中楼是**平级挂载**的——所有回复共享同一个 `parentPostId`，通过 `replyToPostId` 追踪回复目标。前端可据此渲染 @某某 的引用关系。

### 4.4 点赞

```
POST   /threads/:id/like     点赞（幂等，重复点赞不报错）
DELETE /threads/:id/like     取消点赞
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

首页、主题帖搜索、主题帖收藏和用户主页的创建/参与列表共享完整主题帖卡片字段：`defaultSubthread`、`topicTags`、`preview`、`coverImages`、`_count.members/players/posts`。搜索可额外带 `relevance`，本人的收藏管理列表额外带 `bookmarkId` / `bookmarkFolderId`；客户端应复用同一列表卡片模型，不按页面维护较窄副本。公开用户收藏不返回私有收藏元数据。

用户主页概览使用 `GET /users/:id/activity-summary` 获取精确创作统计：`momentCount`、`createdThreadCount`、`playedThreadCount`、`replyCount`。后两项受现有资料隐私控制，查看者无权时为 `null`，客户端应显示“未公开”而不是当作 0；不要为了统计提前拉取并遍历分页列表。

### 4.6 通知

```
GET    /notifications             通知列表（支持 ?type=mention,reply 过滤）
GET    /notifications/unread      未读通知数 → { unreadCount: 5 }
PATCH  /notifications/:id         传 { "isRead": true|false } 设置阅读状态
POST   /notifications/read-all    全部已读
```

每条通知含 `type`、`content`（可读文本）、`payload.schemaVersion` 与具名 `target`。客户端按 `target.kind`（`post` / `thread` / `user` / `none`）导航；新增 payload 字段时保持向后兼容，未知通知类型应降级展示 `content`。

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
   → 后台队列生成 300x300 缩略图 + 480px 信息流图 + 800px 中图 (WebP)

   若返回 404 / MEDIA_OBJECT_MISSING：
   POST /media/:id/upload-url            // 为原 mediaId / objectKey 重签
   → 重新 PUT 后再次 upload-done

4. GET /media/:id                     // 轮询处理状态
   → status: UPLOADING → PROCESSING → COMPLETED
```

文件限制：仅允许 jpg/jpeg、png、gif、webp、avif，最大 10MB；明确拒绝 SVG/BMP。处理完成后响应中的 `thumbnailUrl`（300×300 WebP）和 `mediumUrl`（最长边 800 WebP）可直接用于列表与详情，处理中为 `null`。

Web 上传状态机对确认请求的网络/5xx 做有限重试，并允许最长 120 秒处理轮询。上传失败、取消或签名过期时应保存文件指纹与 `mediaId` 恢复点；业务提交失败时保存已经完成的 `mediaId`，重试业务请求而不是重复上传字节。

### 5.1 主页背景图

主页背景复用上述上传链路。客户端从同一原图分别裁剪 Web 3:1（1920×640）和移动端 2:1（1600×800），均输出质量 0.92 的 WebP：

```text
PATCH  /users/me/profile-cover  {
  "mediaId": "<completed-web-media-id>",
  "mobileMediaId": "<completed-mobile-media-id>"
}
DELETE /users/me/profile-cover
```

服务端会复核两张媒体属于当前用户、状态为 `COMPLETED`、MIME 为 jpg/png/webp，并分别接近 3:1 与 2:1；验证通过后原子绑定。为兼容旧客户端，`mobileMediaId` 可省略，但会清空旧移动裁切，防止新旧构图混用。`GET /users/me` 的 `profileCover` 为必填可空字段；有效用户的 `GET /users/:id` 同样返回该字段，已注销用户仍只返回最小墓碑资料。

```json
{
  "profileCover": {
    "url": "https://cdn.example.com/profile-cover.webp",
    "mediumUrl": "https://cdn.example.com/profile-cover_md.webp",
    "width": 1920,
    "height": 640,
    "mobile": {
      "url": "https://cdn.example.com/profile-cover-mobile.webp",
      "mediumUrl": "https://cdn.example.com/profile-cover-mobile_md.webp",
      "width": 1600,
      "height": 800
    }
  }
}
```

Web 使用根级 3:1 资产；移动端优先使用 `mobile`，历史数据中该字段为 `null` 时回退根级 Web 资产。每套资产都应通过 `srcset` 在显式 `mediumUrl`（当前最长边 800px）和 `url` 原图之间按视口与 DPR 自适应选择；候选图失败或 `mediumUrl` 为空时回退 `url`。客户端不要从原图 URL 自行拼接派生地址。移除背景会解除两套用户引用并返回 `profileCover: null`。服务端不保留上传前原图与裁切参数，再次调整需重新选择文件。

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

## 8. 私聊

```text
用户主页 GET /direct-conversations/by-user/:userId
  ├─ 已有 ACCEPTED/PENDING → 打开 conversation.id
  └─ canInitiate=true → POST /direct-conversations 发送首条消息

活动会话：GET /direct-conversations/:id/messages?after=<lastMessageId>（建议 10 秒）
会话/徽标：GET /direct-conversations 与 /unread（建议 30 秒）
```

- 首条及后续消息使用 `{ content?, mediaId?, clientRequestId }`；发起时额外传 `recipientId`。正文最多 1000 字，与图片至少一项。
- 非互关首条进入 `PENDING`，发起方不能继续发送；接收方用 `PATCH /:id/request` 接受或拒绝。
- 响应不包含 `readAt`。客户端展示到最新接收消息后，用 `POST /:id/read` 发送 `throughMessageId`，不得推断或展示对方已读回执。
- 已接受会话发送新消息会自动解除双方归档。图片沿用媒体上传流程，公开 URL 需要用户侧敏感内容警告。
- 发送者在十分钟内可 `DELETE /direct-messages/:id` 撤回；待处理首条撤回会取消整个请求。
- 拉黑保留已接受会话历史但禁止继续发送；若当时是待处理请求，会直接拒绝并删除首条消息。
- 私聊正文只额外激活统一的站内传送门；整段粘贴合法站内 URL 时写入规范化相对链接，气泡导航但复制保留原始字符串。会话列表的 `contentPreview` 已移除传送门语法并把邀请显示为“邀请传送门”，客户端仍需对旧响应中的残留 `/join/{token}` 防御脱敏。
- 公开主题、楼层、回复、动态或评论分享邀请传送门前由客户端确认；私聊和私密主题不需要公开分享确认。重试同一内容不得重复确认，邀请内容变化后重新确认。

---

## 9. 用户隐私

```json
// PATCH /users/me
{
  "showRecentReplies": false, // 隐藏我的最近回复
  "showPlayerBadges": false, // 隐藏玩家标记
  "showBookmarks": false // 隐藏收藏/订阅
}
```

三个隐私开关分别控制 `GET /users/:id` 下的子端点是否对他人可见（自己始终可见）。

---

## 10. 搜索

```
GET /search/threads?q=关键词&cursor=&limit=20
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

四个全站分类端点供 Tab 按需请求，避免默认执行正文搜索。动态与楼层关键词至少 2 个字符；主题帖与楼层搜索按相关度优先并使用游标分页，继续加载时透传 `meta.cursor`。楼层每页最多 20 条、每个主题帖最多 3 条。用户结果排除已注销账号且不返回邮箱等敏感资料；主题帖与全站正文结果仅搜索已发布的公开帖内容。主题帖搜索返回与 `GET /threads` 相同的完整列表卡片字段，`coverImages` 始终为数组且只提供默认主贴正文中的第一张普通图片 URL，无图时为空数组。分页客户端应显式传 `limit=20`；省略时为兼容旧客户端最多返回 50 条。

`GET /threads` 是发现流契约，服务端保证排除已注销楼主的帖子；主题帖和正文搜索是显式找帖契约，仍保留已注销作者的公开历史内容。客户端不应将搜索结果自动回填到首页列表缓存。

帖内楼层端点使用相同的关键词限制、排序和游标协议，但覆盖指定主题帖的全部子贴且不限制结果为 3 条；公开帖允许匿名调用，私密帖仅成员可调用，未发布帖仅楼主可调用。帖子结果的 `parentPostId` 用于区分主楼层与楼中楼并生成精确定位链接。

`GET /search?q=` 聚合响应仍保留用于旧客户端兼容；新客户端不要使用它实现分类 Tab。

---

## 11. 前端开发建议

Web 与 Flutter 都应从仓库内已审核的 `contracts/openapi.json` 生成类型，实际版本读取 `/meta` 或 `X-API-Contract-Version`；成功响应读取 `data`，分页读取 `meta`，错误响应统一按 `{ code, message, data: null }` 处理，业务分支使用生成的 `BusinessErrorCode`。动态的标题、正文和评论文字是纯文本，不得进入 Markdown 渲染链路；分类选项必须从 `GET /thread-categories` 获取并提交其 `slug`。完整移动端策略见 [Flutter / 原生移动端接入](./mobile-client-guide.md)。

1. **先看 Swagger**：`/api/docs` 有每个端点的请求 Schema（含 example 值）和响应描述，Try it out 可直接调试。
2. **Token 管理**：封装单航班刷新拦截器；只对 `40101 TOKEN_EXPIRED` 刷新一次并重放请求，其他 401 直接进入对应登录/锁定/注销状态，避免刷新风暴。
3. **分页**：列表类用 cursor 游标，第一页不传，后续页传 `meta.cursor`。
4. **乐观锁**：编辑帖子/主题帖时，必须传 `version` 字段（从 GET 详情获得），冲突时 (409) 提示用户刷新。
5. **楼中楼展开**：列表里显示前 5 条 + "查看全部"按钮，点击进入独立楼中楼界面分页加载。
6. **图片上传**：等 `status: COMPLETED` 后再插入 Markdown `![](url)`；列表优先 `thumbnailUrl`，正文预览优先 `mediumUrl`，字段为 null 时回退 `url`。
7. **通知与推送**：前台按需轮询 `/notifications/unread`；Flutter 登录/刷新成功后注册 FCM token，推送只用于唤醒与提示，进入页面后仍以通知/私聊 API 为权威数据源。
8. **内容安全**：帖子/子贴/草稿/简介等 content 字段按 **Markdown 原样存储**（后端不做 HTML 转义）。客户端必须在**渲染层**净化：web 端用 react-markdown（默认剥离原始 HTML 标签、拦截危险 URL）；移动端用 markdown 渲染器，若需渲染原始 HTML 则对渲染输出加净化。**禁止在后端把内容当 HTML 转义后再存**（会破坏 markdown，导致 `>` 变成 `&gt;`）。

---

## 12. 废弃/搁置的功能

| 模块    | 状态     | 说明                                                       |
| ------- | -------- | ---------------------------------------------------------- |
| Reports | 后端就绪 | 类型化举报、管理员队列和原子结案已提供，客户端尚未接入     |
| Admin   | 后端就绪 | 权限、处罚、内容处置、审计和数据看板已提供，客户端尚未接入 |
