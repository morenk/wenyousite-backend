# 草稿模块

## 概述

用户级全局草稿池，提供 5 个固定槽位的草稿保存、更新和删除功能。草稿不与子贴绑定，作为全局编辑器缓存使用。

## 涉及的模型

| 模型 | 用途 |
|------|------|
| `Draft` | 草稿实体（userId + slot 联合唯一，content 文本，version 乐观锁） |

## API 端点

| Method | Path | Guard | 描述 |
|--------|------|-------|------|
| GET | `/drafts` | AuthRead | 获取当前用户全部草稿（按 slot 排序） |
| GET | `/drafts/slots` | AuthRead | 草稿槽位使用情况（usedSlots / maxSlots=5 / slots[]） |
| POST | `/drafts` | Auth | 保存草稿（可指定 slot，不指定自动分配空闲位） |
| GET | `/drafts/:id` | AuthRead | 获取单条草稿 |
| PATCH | `/drafts/:id` | Auth | 更新草稿内容 |
| DELETE | `/drafts/:id` | Auth | 删除草稿 |

读取端点使用 `@AuthRead()`；写入和删除端点使用 `@Auth()`。

## 响应契约

- 草稿列表的 `data` 为 `DraftResponseDto[]`；创建、查询、更新的 `data` 为 `DraftResponseDto`。
- 槽位使用情况的 `data` 为 `DraftSlotUsageResponseDto`。
- 删除结果的 `data` 为 `DeleteDraftResponseDto`。
- 所有 DTO 均位于统一成功 envelope 的 `data` 字段，Web/Flutter 使用生成类型。

## 核心业务规则

- 每个用户最多 5 个草稿槽位（slot 1-5），由 `userId + slot` 联合唯一键约束
- 保存草稿时：
  - 指定 slot：空槽位直接新建；已有草稿必须携带当前 `version` 才能覆盖
  - 不指定 slot：自动扫描 1-5 找第一个空闲位
  - 所有槽位被占满时返回 400 "草稿位已满（5/5），请先删除旧草稿"
- `PATCH /drafts/:id` 必须携带当前 `version`；覆盖成功后原子递增，版本不匹配或并发竞争返回 HTTP 409、`errorCode=40002`
- `version` 是跨 Web/Flutter 的并发事实源，不使用 `updatedAt` 比较，避免客户端日期精度和时区差异
- 草稿不与子贴绑定，作为全局浮动编辑器缓存
- 不存在自动覆盖逻辑：满时不自动替换最旧草稿，明确要求用户手动管理
- 删除为硬删除（物理删除），不使用软删除
- 草稿仅存储 content 纯文本字段
- 创建或更新草稿时统一执行 Markdown v1 规范化，但不执行发布可见性限制

## 乐观锁切片验收

- [x] Draft 新建记录 `version=1`，每次覆盖原子递增
- [x] POST 覆盖已有槽位缺少/不匹配 version 时返回 409
- [x] PATCH 缺少 version 在 DTO 层拒绝，不匹配或竞争失败返回 409
- [x] OpenAPI 响应暴露 version，Web/Flutter 可生成强类型模型
- [x] 全量测试、迁移、生产构建、提交、重启与健康检查通过

## 设计决策

- **5 槽位限制**：通过限制槽位数量防止无限草稿堆积，用户需主动管理草稿空间
- **全局草稿池**：草稿不与子贴绑定，符合 "编辑器全局浮动" 的产品设计；用户可在任意子贴/主题帖间切换时保留编辑内容
- **满时不自动覆盖**：草稿是用户的创作内容，自动覆盖可能导致内容丢失；明确提示后由用户决策删除哪个旧草稿
- **硬删除**：草稿为临时内容，无关联历史或引用，无需软删除保留
- **slot 而非 subthreadId 关联**：用数字槽位管理草稿，前端实现简单的 5 格草稿界面，比关联子贴的命名草稿更直观
