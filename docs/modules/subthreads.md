# 子贴模块

> 子贴标签移除批次：`subthread-tags-removal-2026-08-06`（后端 / Web 同批交付）。

## 概述

主题帖内的子版块管理：创建（正文可选）、列表、详情、修改、软删除、批量拖拽重排，以及发帖权限策略控制。

子贴是 Thread 的内容容器——主题帖本身不放正文，所有楼层（Post）都依附于某个子贴。详见 [主题帖文档 - Thread 与 Subthread 的关系](./threads.md#thread-与-subthread-的关系)。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Subthread` | 子贴实体 |

| 枚举 | 值 |
|------|-----|
| `PostingPolicy` | PARTICIPANTS, COLLABORATORS, PLAYERS |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/threads/:threadId/subthreads` | Public | 子贴列表（按 sortOrder 排序，排除已删除） |
| POST | `/threads/:threadId/subthreads` | AuthRead | 创建子贴（OWNER/COLLABORATOR，标题必填正文可选，sortOrder 自动递增） |
| PUT | `/threads/:threadId/subthreads/reorder` | AuthRead | 批量重排子贴（拖拽排序），首项必须为默认子贴 |
| GET | `/subthreads/:id` | Public | 子贴详情（含所属主题帖信息） |
| PATCH | `/subthreads/:id` | AuthRead | 修改子贴（OWNER/COLLABORATOR，乐观锁 version。默认子贴 sortOrder 不可改） |
| DELETE | `/subthreads/:id` | AuthRead | 软删除子贴（OWNER/COLLABORATOR） |

## 核心业务规则

- 创建子贴：标题必填（MinLength:1），正文可选。提供正文时事务内创建子贴 + kind=BODY 正文帖（floorNumber=null，不占楼层号）；不提供正文时仅创建空子贴
- sortOrder 帖内唯一（@@unique([threadId, sortOrder])），不指定时自动取 MAX+1
- **默认子贴**：每个主题帖最早创建（按 createdAt）的子贴为默认子贴，its sortOrder 固定为 0 且不可修改，不可单独删除——需删除整个主题帖。拖拽重排时必须保持默认子贴为第一位
- 拖拽重排：`PUT /threads/:threadId/subthreads/reorder`，传入目标顺序的 ID 数组，两轮事务更新避免 UNIQUE 冲突
- `postingPolicy` 控制发帖权限：
  - PARTICIPANTS：所有已通过主题帖访问校验的登录用户均可发帖，发帖后自动进入参与人候选池
  - COLLABORATORS：仅 OWNER 和 COLLABORATOR 可发帖
  - PLAYERS：仅拥有玩家身份（playerMarked=true）的参与人可发帖；OWNER/COLLABORATOR 绕过限制。玩家身份由楼主或协作者通过参与人管理端点授予/收回
- CLOSED、FINISHED 仅展示状态，不会自动禁止发帖；如需限制请调整子贴 postingPolicy
- 软删除通过 deletedAt 字段实现，列表查询过滤 `deletedAt: null`
- sortOrder 控制子贴在主题帖内的显示顺序（按升序排列）
- 修改使用乐观锁（version 字段），并发冲突返回提示
- 删除子贴需同时检查子贴自身和所属主题帖是否存在及是否已被删除

## 设计决策

- **子贴正文可选**：创建子贴时正文非必填，允许楼主先搭建子版块框架再逐步填充内容。前端合并子贴表单和正文编辑器一同提交，正文以 kind=BODY 帖保存，正文为空时仅创建空子贴
- **sortOrder 帖内唯一**：通过数据库唯一约束保证同一主题帖内编号不重复。创建时自动递增分配（MAX+1），修改时检测冲突。默认子贴固定为 0
- **乐观锁保护**：子贴编辑场景多用户协作，version 字段防止基于过期数据的覆盖写
- **软删除而非物理删除**：保留帖内楼层数据的完整性，子贴删除后已发的帖子内容通过 deletedAt 隐藏但保留关联

## 2.0 合同迁移

2026-08-06 起产品取消子贴标签，合同版本升级为 `2.0.0-dev.20260806`。这是破坏性变更：删除 `/subthreads/:subthreadId/tags` 读写端点，子贴详情及主题帖详情中的子贴对象不再返回 `tags`，数据库迁移删除 `subthread_tags` 与 `subthread_tag_defs`。主题帖的 `topicTags` 与 `/threads/:threadId/tags` 不受影响。

Web 与移动端必须先停止读取、展示和写入子贴标签，再切换 2.0 后端；旧客户端没有兼容窗口。迁移前需完成数据库备份，回退时先恢复两张表及 1.x 后端，再恢复旧客户端。
