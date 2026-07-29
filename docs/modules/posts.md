# 楼层模块

## 概述

子贴内的楼层发帖、楼中楼回复、编辑、软删除、点赞/取消点赞，以及 @提及解析和通知事件触发。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Post` | 帖子实体（楼层 / 楼中楼回复） |
| `PostLike` | 点赞关系（postId + userId 联合唯一） |
| `PostMention` | @提及记录（归属帖子，由 PostEventsListener 写入） |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/subthreads/:subthreadId/posts` | Public | 楼层列表（Cursor 分页，仅主楼层 parentPostId=null，内嵌每个楼层前 3 条楼中楼回复） |
| GET | `/posts/:id/replies` | Public | 楼中楼回复列表（Cursor 分页，无限下拉） |
| POST | `/subthreads/:subthreadId/posts` | Auth | 发帖（楼层或楼中楼回复） |
| GET | `/posts/:id` | Public | 帖子详情（含导航上下文：帖/子贴/父楼） |
| PATCH | `/posts/:id` | Auth | 编辑帖子（仅作者，乐观锁 version） |
| DELETE | `/posts/:id` | Auth | 软删除帖子（不能删除子贴第一楼） |
| POST | `/posts/:id/like` | Auth | 点赞 |
| DELETE | `/posts/:id/like` | Auth | 取消点赞 |

## 核心业务规则

- 发帖前校验主题帖访问权限（`ThreadAccessService.assertAccessible`）：私密帖非参与人被拒绝，未发布帖非 owner 被拒绝
- 发帖权限校验在自动加入之前：被 PostingPolicy 拒绝时不会写入 ThreadMember 记录
- 楼层编号 floorNumber 在事务内通过 `MAX(floorNumber) + 1` 分配，永不复用
- 楼中楼回复 floorNumber = null，通过 parentPostId 关联父楼层
- 楼中楼平级挂载：所有回复共享同一个 parentPostId，无嵌套深度限制；回复目标通过 replyToPostId 追踪
- parentPostId 必须属于同一子贴且为主楼层（parentPostId=null），否则拒绝
- replyToPostId 必须属于同一子贴，否则拒绝
- 软删除：设置 deletedAt，列表查询过滤已删除帖子；编辑/删除操作也校验子贴是否已软删
- 子贴主体正文不可删除（floorNumber=1 且无 parentPostId），提示"主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴"
- 权限校验通过后自动将用户加入主题帖（upsert ThreadMember，角色 PARTICIPANT）
- 发帖权限由子贴的 postingPolicy 控制：
  - COLLABORATORS：仅 OWNER/COLLABORATOR 可发帖
  - PLAYERS：仅 playerMarked=true 的参与人可发帖
- 发帖后通过 EventEmitter 发射 `post.created` 事件，由 PostEventsListener 解耦处理 @提及解析和通知投递
- 点赞/取消点赞前校验主题帖访问权限（`ThreadAccessService.assertAccessible`）
- 点赞使用 PostLike upsert 保证幂等（重复点赞不报错，但 likeCount 不会重复增加）
- likeCount 直接维护在 Post 表上，用于快速排序和展示，不依赖 count 聚合查询
- 编辑使用乐观锁 version 防止并发编辑冲突
- 楼层列表按 floorNumber ASC 排序（主楼层），楼中楼按 createdAt ASC 排序
- 楼层列表响应中每个楼层内嵌 `replies` 字段（前 3 条楼中楼回复），含 `author` 和 `replyToPost`；`_count.replies` 提供回复总数，超过 3 条时前端显示"查看全部 N 条回复"入口跳转至独立楼中楼界面

## 设计决策

- **楼层编号事务内分配**：`SELECT MAX + 1` 在事务内执行，防止并发发帖导致的编号冲突和空洞
- **楼中楼平级设计**：所有回复共享 parentPostId，通过 replyToPostId 区分回复目标，避免无限嵌套的 UI 复杂度和查询复杂度
- **事件解耦 @提及和通知**：发帖服务不直接处理 @提及解析（涉用户匹配逻辑）和通知投递（涉订阅查询逻辑），通过 EventEmitter 发射事件到 PostEventsListener 异步处理，单一职责
- **likeCount 字段冗余**：在 Post 表冗余 likeCount 避免高频 count 聚合查询，通过事务内 upsert PostLike + increment likeCount 保持一致性；极端情况下数据可能偏差但可接受
- **主体正文保护**：子贴正文（floorNumber=1 且无 parentPostId）不可删除，删除它等同于删除子贴；通过检查 floorNumber 和 parentPostId 双重条件阻止误删。如需移除正文请删除整个子贴
