# 主题帖模块

## 概述

主题帖的创建、列表、详情、修改、软删除，成员管理（加入/邀请/角色/踢出），私密帖邀请链接，置顶排序，标签管理。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Thread` | 主题帖实体 |
| `ThreadMember` | 帖内成员关系（userId + role + playerMarked） |
| `ThreadInvite` | 私密帖邀请链接（token + threadId，一对一 upsert） |
| `ThreadTopicTag` | 主题帖与平台 TopicTag 的多对多关联 |
| `SubthreadTagDef` | 子贴标签定义（归属主题帖，用于标签管理） |

| 枚举 | 值 |
|------|-----|
| `ThreadCategory` | DEDUCTION, NATION, RPG |
| `ThreadStatus` | RECRUITING, CLOSED, FINISHED |
| `ThreadVisibility` | PUBLIC, PRIVATE |
| `MemberRole` | OWNER, COLLABORATOR, PARTICIPANT |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/threads` | Public | 主题帖列表（分区/排序/标签筛选/Cursor 分页） |
| POST | `/threads` | AuthRead | 创建主题帖（事务：Thread + 首个子贴 + 第一楼 + OWNER 成员） |
| GET | `/threads/:id` | AuthRead | 主题帖详情（含子贴列表和标签） |
| PATCH | `/threads/:id` | AuthRead | 修改主题帖（OWNER/COLLABORATOR，乐观锁 version） |
| DELETE | `/threads/:id` | AuthRead | 软删除（仅 OWNER） |
| POST | `/threads/:id/invite-link` | AuthRead | 生成/刷新私密帖邀请链接（仅 OWNER） |
| POST | `/threads/join-by-link/:token` | AuthRead | 通过邀请链接加入私密帖 |
| GET | `/threads/:threadId/members` | Public | 成员列表 |
| POST | `/threads/:threadId/members/join` | AuthRead | 自由加入（公开帖） |
| POST | `/threads/:threadId/members` | AuthRead | 邀请用户加入（OWNER/COLLABORATOR） |
| PATCH | `/threads/:threadId/members/:userId` | AuthRead | 修改成员角色/玩家标记 |
| DELETE | `/threads/:threadId/members/:userId` | AuthRead | 踢出成员 |
| GET | `/threads/:threadId/tags` | Public | 主题帖标签列表 |
| POST | `/threads/:threadId/tags` | AuthRead | 添加标签（OWNER/COLLABORATOR） |
| DELETE | `/threads/:threadId/tags/:tagId` | AuthRead | 移除标签 |

## 核心业务规则

- 创建主题帖在事务内完成：创建 Thread → 创建首个 Subthread → 创建第一楼 Post（floorNumber=1）→ 创建 OWNER 成员 → 关联标签
- 创建后异步通知所有粉丝（thread_created 类型），fire-and-forget
- 列表接口 `findAll` 仅返回 visibility=PUBLIC 且 deletedAt=null 的主题帖
- 排序规则：置顶帖优先（pinned DESC），其次按 createdAt 或 updatedAt（sort=active）
- Cursor 分页：limit 默认 20 最大 50，返回 cursor + hasMore
- 详情接口 `findById` 增加 viewCount（异步 fire-and-forget），私密帖非成员返回 404
- 修改和删除使用乐观锁（version 字段），并发冲突返回 "主题帖已被修改，请刷新后重试"
- 删除为软删除（设置 deletedAt），仅 OWNER 可操作
- 成员管理权限：OWNER/COLLABORATOR 可管理（邀请、角色修改、踢出），不能修改/踢出 OWNER
- 私密帖禁止自由加入（POST join），仅可通过邀请链接加入
- 私密帖踢出仅取消 playerMarked 标记，不删除成员记录
- 邀请链接使用 ThreadInvite 表 upsert（每个私密帖一个有效 token，重新生成时覆盖旧 token）
- token 为随机 16 位小写字母+数字字符串

## 设计决策

- **事务创建**：Thread + Subthread + Post + Member 四者强关联，事务保证原子性，避免部分创建导致的数据不一致
- **首次创建含内容**：创建主题帖同时必须提供 content，作为第一楼正文存入 Post 表，由前端编辑器和创建表单合并提交
- **乐观锁 version**：比悲观锁更适合读多写少的协作编辑场景；使用 Prisma 的 where { version } + data { version: increment: 1 } 实现原子比较并更新
- **私密帖踢出仅取消标记**：私密帖中通过邀请链接加入的成员不可完全移除，踢出操作降级为取消玩家身份（playerMarked = false），保留成员的访问权和发帖权
- **viewCount 异步更新**：不阻塞详情接口的返回，使用 fire-and-forget catch，牺牲极端情况下的精度换取响应速度
