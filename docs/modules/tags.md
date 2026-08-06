# 标签

## 概述
标签模块管理平台级主题帖标签（TopicTag），用于跨帖搜索与筛选。子贴不再提供标签能力。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `TopicTag` | 平台级标签，全局唯一名称，用于主题帖筛选 |
| `ThreadTopicTag` | 主题帖与 TopicTag 的多对多关联表 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/tags` | `@Public()` | 搜索 TopicTag（可选 `?q=` 模糊搜索） |
| `GET` | `/tags/:id` | `@Public()` | 获取单个标签详情 |
| `POST` | `/tags` | `@AuthRead()` | 创建 TopicTag |

## 核心业务规则

- TopicTag 的 `name` 字段全局唯一，创建时先检查冲突
- TopicTag 可选 `color` 字段（十六进制 `#RRGGBB`）
- 标签名限制 1-20 字符，仅允许字母、数字、下划线、中文和 `#`
- `findOrCreate` 方法批量查找或创建标签，用于创建/编辑主题帖时关联标签

## 设计决策

- `findOrCreate` 采用先查询已有、再批量创建缺失的模式，减少数据库往返次数
- TopicTag 创建通过 `createMany` 批量写入缺失标签，避免逐条创建的 N+1 问题
