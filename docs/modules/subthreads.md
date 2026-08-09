# 子贴模块

## 概述

主题帖内的子版块管理：创建（正文可选）、列表、详情、修改、软删除、批量拖拽重排，以及发帖权限策略控制。

子贴是 Thread 的内容容器——主题帖本身不放正文，所有楼层（Post）都依附于某个子贴。详见 [主题帖文档 - Thread 与 Subthread 的关系](./threads.md#thread-与-subthread-的关系)。

## 涉及的模型

| 模型        | 用途     |
| ----------- | -------- |
| `Subthread` | 子贴实体 |

| 枚举            | 值                                   |
| --------------- | ------------------------------------ |
| `PostingPolicy` | PARTICIPANTS, COLLABORATORS, PLAYERS |

## API 端点

| Method | Path                                    | Guard    | 描述                                                                      |
| ------ | --------------------------------------- | -------- | ------------------------------------------------------------------------- |
| GET    | `/threads/:threadId/subthreads`         | Public   | 子贴列表（按 sortOrder 排序，排除已删除）                                 |
| POST   | `/threads/:threadId/subthreads`         | AuthRead | 创建子贴（OWNER/COLLABORATOR，标题必填正文可选，sortOrder 自动递增）      |
| PUT    | `/threads/:threadId/subthreads/reorder` | AuthRead | 批量重排子贴（拖拽排序），首项必须为默认子贴                              |
| GET    | `/subthreads/:id`                       | Public   | 子贴详情（含所属主题帖信息）                                              |
| PATCH  | `/subthreads/:id`                       | AuthRead | 修改子贴（OWNER/COLLABORATOR，乐观锁 version。默认子贴 sortOrder 不可改） |
| DELETE | `/subthreads/:id`                       | AuthRead | 软删除子贴（OWNER/COLLABORATOR）                                          |

## 核心业务规则

- 创建子贴：标题必填（MinLength:1），正文可选。提供正文时事务内创建子贴 + kind=BODY 正文帖（floorNumber=null，不占楼层号）；不提供正文时仅创建空子贴
- 活跃子贴的 sortOrder 帖内唯一，由 `WHERE deleted_at IS NULL` 的数据库部分唯一索引保证；软删除记录不继续占用序号。不指定时在锁定父 Thread 行后取活跃集合的 MAX+1，串行化同帖并发创建
- **默认子贴**：每个主题帖最早创建（按 createdAt）的子贴为默认子贴，its sortOrder 固定为 0 且不可修改，不可单独删除——需删除整个主题帖。拖拽重排时必须保持默认子贴为第一位
- 拖拽重排：`PUT /threads/:threadId/subthreads/reorder` 必须传入当前全部活跃子贴 ID，数组不可为空、不可重复、不可缺失或夹带其他主题帖 ID，且默认子贴必须位于首项。事务锁定父 Thread 并读取全集后，两轮更新避开唯一键交换冲突；并发写冲突统一返回 409
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
- **sortOrder 帖内唯一**：通过活跃行部分唯一索引保证同一主题帖内编号不重复。创建时在父 Thread 行锁内自动递增分配（MAX+1），修改和重排时把数据库唯一冲突映射为 409。默认子贴固定为 0
- **乐观锁保护**：子贴编辑场景多用户协作，version 字段防止基于过期数据的覆盖写
- **软删除而非物理删除**：保留帖内楼层数据的完整性，子贴删除后已发的帖子内容通过 deletedAt 隐藏但保留关联

子贴标签已经移除，追溯信息见 [子贴标签移除记录](../history/subthread-tags-removal-2026-08-06.md)。当前客户端不得读取或提交子贴标签。
