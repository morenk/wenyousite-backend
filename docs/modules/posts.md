# 楼层模块

## 概述

子贴内的楼层发帖、楼中楼回复、编辑、软删除，以及 @提及解析和通知事件触发。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Post` | 帖子实体（正文 kind=BODY / 楼层 kind=FLOOR / 楼中楼回复） |
| `PostMention` | @提及记录（归属帖子，由 PostEventsListener 写入） |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/subthreads/:subthreadId/posts` | Public | 楼层列表（Cursor 分页，仅返回楼层 kind=FLOOR，不含正文；主楼层 parentPostId=null，内嵌每个楼层前 5 条楼中楼回复） |
| GET | `/posts/:id/replies` | Public | 主楼层的楼中楼回复列表（Cursor 分页，无限下拉；仅接受 parentPostId=null 的 FLOOR） |
| POST | `/subthreads/:subthreadId/posts` | Auth | 发帖（创建楼层 kind=FLOOR，含楼中楼回复；正文不通过本接口创建） |
| PUT | `/subthreads/:subthreadId/body` | Auth | upsert 子贴正文（kind=BODY：无正文创建，有正文乐观锁更新，version 不匹配返回 409；仅 OWNER/COLLABORATOR） |
| GET | `/posts/:id` | Public | 帖子详情（含导航上下文：帖/子贴/父楼） |
| PATCH | `/posts/:id` | Auth | 编辑帖子（仅作者，乐观锁 version） |
| DELETE | `/posts/:id` | Auth | 软删除楼层（仅楼层 kind=FLOOR，正文 kind=BODY 不可删） |

## 响应契约

- 楼层分页接口的 `data` 为 `FloorResponseDto[]`，楼中楼分页接口的 `data` 为 `ReplyResponseDto[]`，游标位于统一 envelope 的 `meta`。
- 创建楼层、upsert 子贴正文和编辑帖子的 `data` 为 `PostResponseDto`。
- 帖子详情的 `data` 为 `PostDetailResponseDto`，包含帖、子贴、父楼和回复计数导航上下文。
- Web/Flutter 必须使用 Swagger 生成类型，不再手写帖子响应结构。

## 核心业务规则

- 发帖前校验主题帖访问权限（`ThreadAccessService.assertAccessible`）：私密帖非参与人被拒绝，未发布帖非 owner 被拒绝
- 正文发布校验只过滤空白、空段落和独立分隔线；纯数字正文（如 `123`、`1.00`）属于有效内容
- 发帖权限校验在自动加入之前：被 PostingPolicy 拒绝时不会写入 ThreadMember 记录
- 楼层编号 floorNumber 在事务内通过 `MAX(floorNumber) + 1` 分配，永不复用；普通楼层（kind=FLOOR）从 #1 开始
- 正文帖（kind=BODY）floorNumber = null，不占楼层号
- 楼中楼回复 floorNumber = null，通过 parentPostId 关联父楼层
- 楼中楼平级挂载：所有回复共享同一个 parentPostId，无嵌套深度限制；回复目标通过 replyToPostId 追踪
- parentPostId 必须属于同一子贴且为主楼层（parentPostId=null），否则拒绝
- replyToPostId 必须属于同一子贴，否则拒绝
- 软删除：设置 deletedAt，列表查询过滤已删除帖子；编辑/删除操作也校验子贴是否已软删
- 子贴正文（kind=BODY）不可删除，提示"主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴"
- 权限校验通过后自动将用户加入主题帖（upsert ThreadMember，角色 PARTICIPANT）
- 发帖权限由子贴的 postingPolicy 控制：
  - COLLABORATORS：仅 OWNER/COLLABORATOR 可发帖
  - PLAYERS：仅 playerMarked=true 的参与人可发帖
- 发帖后通过 EventEmitter 发射 `post.created` 事件，由 PostEventsListener 解耦处理 @提及解析和通知投递
- 编辑使用乐观锁 version 防止并发编辑冲突
- 楼层列表按 floorNumber ASC 排序（主楼层），楼中楼按 createdAt ASC、id ASC 稳定排序；`parentPostId + createdAt` 复合索引支撑上百条回复的分页读取
- 独立楼中楼阅读页复用 `GET /posts/:id` 获取原楼层及主题帖/子贴导航上下文，再用 `GET /posts/:id/replies` 分页读取回复；replies 接口拒绝以正文或楼中楼回复作为讨论根
- 楼层列表响应中每个楼层内嵌 `replies` 字段（前 5 条楼中楼回复），含 `author` 和 `replyToPost`；`replyToPost` 关联被回复的目标帖并带出其 `author`（前端据此显示「回复 @xxx」上下文）；`_count.replies` 提供回复总数，超过 5 条时前端显示"查看全部 N 条回复"入口跳转至独立楼中楼界面
- 楼中楼回复稳定链接格式为 `/threads/{threadId}/posts/{parentPostId}/replies?post={replyId}`，由前端根据现有响应字段生成，不新增后端端点
- 主楼层稳定链接格式为 `/threads/{threadId}?post={postId}`，由前端根据现有响应字段生成，不新增后端端点
- 子贴正文通过 `PUT /subthreads/:subthreadId/body` upsert：无正文时创建 kind=BODY 帖（floorNumber=null），有正文时乐观锁更新（version 不匹配返回 409）。后端把子贴的 kind=BODY 帖映射回响应字段 `bodyPost`（不再有 `bodyPostId`），编辑器依赖 `subthread.bodyPost` 加载可编辑正文
- `_count.posts`（子贴与线程）只统计楼层（kind=FLOOR），正文（kind=BODY）不计入
- 楼层列表接口只返回 kind=FLOOR，不含正文；正文经详情接口的 `bodyPost` 字段返回

## 设计决策

- **楼层编号事务内分配**：`SELECT MAX + 1` 在事务内执行，防止并发发帖导致的编号冲突和空洞
- **楼中楼平级设计**：所有回复共享 parentPostId，通过 replyToPostId 区分回复目标，避免无限嵌套的 UI 复杂度和查询复杂度
- **独立阅读页不新增数据模型**：原楼层只在视觉上充当讨论正文，存储语义仍为 FLOOR；其下回复继续通过 parentPostId 平级关联
- **事件解耦 @提及和通知**：发帖服务不直接处理 @提及解析（涉用户匹配逻辑）和通知投递（涉订阅查询逻辑），通过 EventEmitter 发射事件到 PostEventsListener 异步处理，单一职责
- **主体正文保护**：子贴正文（kind=BODY）不可删除，删除它等同于删除子贴；通过 kind=BODY 判断阻止误删。如需移除正文请删除整个子贴
