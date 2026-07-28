# 主题帖模块

## 概述

主题帖的草稿创建、沙盒迭代、发布、列表、详情、修改、删除，成员管理（加入/邀请/角色/收回玩家身份），私密帖邀请链接，置顶排序，标签管理。

**核心流程**：所有主题帖创建统一走"草稿 → 发布"两阶段 —— `POST /threads` 创建空壳草稿（published=false），在沙盒内逐步完善标题/子贴/楼层，最后通过 `PATCH /threads/:id { published: true }` 发布。发布前帖子不出现在列表/搜索中，仅楼主本人可访问。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Thread` | 主题帖实体（含 published 字段控制发布状态） |
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
| GET | `/threads/draft` | AuthRead | 我的草稿箱列表（published=false 的帖） |
| POST | `/threads` | Auth | 创建主题帖草稿（仅 Thread + OWNER 成员，无子贴/帖子） |
| GET | `/threads` | Public | 主题帖列表（仅已发布帖）。`filter=all`(默认)公开帖，`filter=playing`我参与的帖 |
| GET | `/threads/:id` | AuthRead | 详情（含子贴列表和标签）。未发布帖仅 owner 可查看 |
| PATCH | `/threads/:id` | Auth | 修改/发布（OWNER/COLLABORATOR，乐观锁）。设置 published=true 即发布，校验完整性后通知粉丝 |
| DELETE | `/threads/:id` | Auth | 删除（仅 OWNER）。草稿帖硬删除（级联），已发布帖软删除 |
| POST | `/threads/:id/invite-link` | Auth | 生成/刷新私密帖邀请链接（需已发布，仅 OWNER） |
| POST | `/threads/join-by-link/:token` | Auth | 通过邀请链接加入私密帖（需已发布） |
| GET | `/threads/:threadId/members` | Public | 成员列表 |
| POST | `/threads/:threadId/members/join` | Auth | 自由加入（需已发布，PRIVATE 帖禁止） |
| POST | `/threads/:threadId/members` | Auth | 邀请用户加入（需已发布，OWNER/COLLABORATOR） |
| PATCH | `/threads/:threadId/members/:userId` | Auth | 修改成员角色/玩家标记 |
| DELETE | `/threads/:threadId/members/me` | AuthRead | 主动退出（取消自己的 playerMarked），OWNER 不可退出 |
| DELETE | `/threads/:threadId/members/:userId` | Auth | 收回该成员的玩家身份（统一逻辑，不再区分公开/私密） |
| GET | `/threads/:threadId/tags` | Public | 主题帖标签列表 |
| POST | `/threads/:threadId/tags` | Auth | 添加标签（OWNER/COLLABORATOR） |
| DELETE | `/threads/:threadId/tags/:tagId` | Auth | 移除标签 |

## 核心业务规则

### 草稿与发布

- 创建草稿：`POST /threads` 仅创建 Thread(published=false) + OWNER 成员（playerMarked=true）。不自动创建子贴和楼层，标题缺省为"未命名草稿"
- 沙盒迭代：楼主可在草稿内自由创建子贴（`POST subthreads`）、撰写楼层（`POST posts`），所有端点自动保存
- 草稿列表：`GET /threads/draft` 返回当前用户所有未发布帖，按 createdAt DESC 排序
- 发布校验：`PATCH /threads/:id { published: true }` 时校验 —— ① title 非空且非默认值"未命名草稿" ② category 已设置 ③ 至少存在一个子贴 ④ 该子贴有未删除的帖子
- 发布后通知：校验通过后 published=true，异步通知创建者的所有粉丝（thread_created 类型）
- 草稿内发帖不触发 @提及解析和通知（`post.created` 事件仅在已发布帖下发帖时发射）
- 草稿仅 owner 可查看和操作，非 owner 访问返回 404
- 草稿帖删除为硬删除（级联删除子贴/帖子/成员），已发布帖删除为软删除

### 列表与详情

- 列表接口 `findAll`：仅返回 published=true 的帖；`filter=all`(默认)仅 PUBLIC 帖；`filter=playing`返回 playerMarked=true 的帖（含私密帖），需登录
- 详情接口 `findById`：未发布帖仅 owner 可查看且不递增 viewCount；已发布帖 viewCount 异步 +1，PRIVATE 帖非成员返回 404
- 排序规则：置顶帖优先（pinned DESC），其次按 createdAt 或 updatedAt（sort=active）
- Cursor 分页：limit 默认 20 最大 50，返回 cursor + hasMore

### 成员管理

- 修改和删除使用乐观锁（version 字段），并发冲突返回 "主题帖已被修改，请刷新后重试"
- 成员管理权限：OWNER/COLLABORATOR 可管理（邀请、角色修改、收回玩家身份），不能修改/收回 OWNER
- 私密帖禁止自由加入（POST join），仅可通过邀请链接加入
- 收回玩家身份：取消该成员的 playerMarked 标记。成员记录保留，仍可浏览和在 PARTICIPANTS 策略子贴中发帖
- 成员可主动退出（DELETE me）：取消自己的 playerMarked，OWNER 不可退出
- 玩家身份决定 PLAYERS 策略子贴的发帖权限，详见子贴文档

### 邀请链接

- 仅已发布的私密帖可生成邀请链接（未发布或公开帖均禁止）
- 通过邀请链接加入私密帖：需帖子已发布，成员角色为 PARTICIPANT
- 邀请链接使用 ThreadInvite 表 upsert，token 为随机 16 位小写字母+数字

## 设计决策

- **草稿沙盒**：Thread 本身即为沙盒 —— published=false 时帖子不对外，楼主可在沙盒内任意搭建子贴、撰写楼层。发布时仅翻转 published 标记，数据零迁移
- **发布即校验**：创建草稿时零必填字段，所有完整性校验推迟到发布时刻。这样用户可以分步填写、随时退出、续接编辑
- **草稿内不发通知**：发帖事件（post.created）仅在已发布帖下发帖时发射，草稿内的所有操作不触发 @提及解析和通知。通知逻辑移至 publish 时刻（thread_created 通知粉丝）
- **未发布帖硬删除**：草稿帖数据尚未对外发布，硬删除可直接级联清理所有关联的子贴/帖子/成员。定时任务每天凌晨 4 点清理超过 7 天未发布的草稿
- **乐观锁 version**：比悲观锁更适合读多写少的协作编辑场景；使用 Prisma 的 where { version } + data { version: increment: 1 } 实现原子比较并更新
- **viewCount 异步更新**：不阻塞详情接口的返回，使用 fire-and-forget catch，牺牲极端情况下的精度换取响应速度。未发布帖不递增 viewCount

## TODO

- 主题帖列表卡片正文预览：`findAll()` 需 include 第一个子贴的首条 Post 正文内容，前端截取前 N 字展示
