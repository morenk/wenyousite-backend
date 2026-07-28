# 搜索

## 概述
搜索模块提供基于 PostgreSQL ILIKE 的全文本搜索，同时搜索主题帖标题和帖子内容。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Thread` | 主题帖，按标题匹配 |
| `Post` | 楼层/楼中楼，按内容匹配 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/search?q=` | `@Public()` | 全文搜索主题帖标题和楼层内容 |

## 核心业务规则

- 基于 PostgreSQL `ILIKE`（`contains + mode: 'insensitive'`）实现大小写不敏感搜索
- 主题帖搜索：仅匹配标题，过滤 `deletedAt: null` 和 `visibility: 'PUBLIC'`
- 帖子搜索：匹配正文内容，仅过滤 `deletedAt: null`
- 两类结果各最多返回 50 条
- 主题帖结果按 `updatedAt` 降序，帖子结果按 `createdAt` 降序
- 空关键词返回 `{ threads: [], posts: [] }`

## 设计决策

- 使用 PostgreSQL 内置 ILIKE 而非 Elasticsearch，降低运维复杂度，适合当前数据规模
- 主题帖结果仅包含 PUBLIC 可见性的帖子，确保私密帖不外泄
- 限制 50 条上限，防止通配搜索对数据库造成压力并控制响应体积
