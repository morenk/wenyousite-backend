# 子贴模块

## 概述

主题帖内的子版块管理：创建（含第一楼）、列表、详情、修改、软删除，以及发帖权限策略控制。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Subthread` | 子贴实体 |
| `SubthreadTag` | 子贴与 SubthreadTagDef 的多对多关联 |
| `SubthreadTagDef` | 子贴标签定义（归属主题帖，支持颜色） |

| 枚举 | 值 |
|------|-----|
| `PostingPolicy` | PARTICIPANTS, COLLABORATORS, PLAYERS |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/threads/:threadId/subthreads` | Public | 子贴列表（按 sortOrder 排序，排除已删除） |
| POST | `/threads/:threadId/subthreads` | AuthRead | 创建子贴（OWNER/COLLABORATOR，事务创建子贴+第一楼） |
| GET | `/subthreads/:id` | Public | 子贴详情（含所属主题帖信息） |
| PATCH | `/subthreads/:id` | AuthRead | 修改子贴（OWNER/COLLABORATOR，乐观锁 version） |
| DELETE | `/subthreads/:id` | AuthRead | 软删除子贴（OWNER/COLLABORATOR） |
| GET | `/subthreads/:subthreadId/tags` | Public | 子贴标签列表 |
| POST | `/subthreads/:subthreadId/tags` | AuthRead | 添加标签（OWNER/COLLABORATOR，支持 name + color） |
| DELETE | `/subthreads/:subthreadId/tags/:tagId` | AuthRead | 移除标签 |

## 核心业务规则

- 创建子贴在事务内完成：创建 Subthread → 创建第一楼 Post（floorNumber=1），保证原子性
- `postingPolicy` 控制发帖权限：
  - PARTICIPANTS：所有成员均可发帖
  - COLLABORATORS：仅 OWNER 和 COLLABORATOR 可发帖
  - PLAYERS：仅拥有玩家身份（playerMarked=true）的成员可发帖。玩家身份由楼主或协作者通过成员管理端点授予/收回
- 软删除通过 deletedAt 字段实现，列表查询过滤 `deletedAt: null`
- **默认子贴保护**：主题帖创建时生成的第一个子贴（sortOrder=0，最早 createdAt）不可单独删除，需删除整个主题帖。后续创建的子贴可自由删除
- sortOrder 控制子贴在主题帖内的显示顺序
- 修改使用乐观锁（version 字段），并发冲突返回提示
- 子贴标签使用 SubthreadTagDef 存储定义（name + color），通过 SubthreadTag 关联
- 子贴标签的增删操作需通过 SubthreadsService.assertCanManage 校验管理权限
- 删除子贴需同时检查子贴自身和所属主题帖是否存在及是否已被删除

## 设计决策

- **子贴创建必须含内容**：与主题帖创建逻辑一致，创建子贴时必须提供 content 作为第一楼正文。前端合并子贴表单和第一楼编辑器一同提交
- **乐观锁保护**：子贴编辑场景多用户协作，version 字段防止基于过期数据的覆盖写
- **子贴标签独立定义**：SubthreadTagDef 归属主题帖而非平台级，支持不同帖子的子贴使用同名不同色的标签
- **软删除而非物理删除**：保留帖内楼层数据的完整性，子贴删除后已发的帖子内容通过 deletedAt 隐藏但保留关联
