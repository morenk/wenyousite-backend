# 温油站后端文档

## 概述

本目录包含温油站后端的完整技术文档。每个模块有独立文档，加上跨模块的专项文档。

## 导航

### 核心参考

| 文档 | 内容 |
|------|------|
| [**前端接入指南**](./frontend-guide.md) | **面向前端开发者：认证流程、分页约定、核心业务示例、错误码速查** |
| [API 端点表](./api-endpoints.md) | 全部 48 个端点的方法、路径、守卫、参数说明 |
| [API 参数校验规范](./api-validation.md) | 全局校验管道、DTO 编写规范、参数类型约束细则 |
| [数据模型](./data-model.md) | 22 张表 + 8 个枚举，含字段说明和关系 |
| [图片上传管线](./image-upload.md) | 预签名上传 → S3 直传 → 确认 → sharp 缩略图 |
| [通知投递规则](./notification-delivery.md) | 5 类通知的触发条件和接收者矩阵 |

### 模块文档

| 文档 | 模块 | 职责 |
|------|------|------|
| [auth](./modules/auth.md) | 认证 | 注册、登录、Token 刷新、邮箱验证、改密码、找回密码 |
| [users](./modules/users.md) | 用户 | 资料、关注、拉黑、注销 |
| [threads](./modules/threads.md) | 主题帖 | CRUD、成员管理、私密帖、邀请链接、置顶 |
| [subthreads](./modules/subthreads.md) | 子贴 | CRUD、排序、发帖权限策略 |
| [posts](./modules/posts.md) | 楼层 | 发帖、楼中楼、编辑、软删除、点赞、@提及 |
| [drafts](./modules/drafts.md) | 草稿 | 用户级全局 5 槽位草稿池 |
| [notifications](./modules/notifications.md) | 通知 | 列表、未读数、已读 |
| [subscriptions](./modules/subscriptions.md) | 订阅 | THREAD/USER 订阅 + 通知投递 |
| [media](./modules/media.md) | 媒体 | 预签名 URL、upload-done、sharp 图片处理 |
| [tags](./modules/tags.md) | 标签 | TopicTag + SubthreadTagDef 双标签系统 |
| [search](./modules/search.md) | 搜索 | PostgreSQL ILIKE 全文搜索 |
| [bookmarks](./modules/bookmarks.md) | 收藏 | 用户收藏主题帖，公开/私密帖 |
| [reading-progress](./modules/reading-progress.md) | 阅读进度 | 记录进度、新增回复数 |
| [reports](./modules/reports.md) | 举报 | 已搁置，待后期重构 |
| [admin](./modules/admin.md) | 管理后台 | 管理后台 API（已搁置，待后续开发） |
| [jobs](./modules/jobs.md) | 任务队列 | BullMQ 通知队列、图片处理队列、定时清理 |

## 快速查找

- **想知道某个 API 怎么调用？** → [API 端点表](./api-endpoints.md)
- **想知道某张表有哪些字段？** → [数据模型](./data-model.md)
- **想知道上传图片的完整流程？** → [图片上传管线](./image-upload.md)
- **想知道什么情况会收到通知？** → [通知投递规则](./notification-delivery.md)
