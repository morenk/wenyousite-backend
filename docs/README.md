# 温油站后端文档

## 概述

本目录包含温油站后端的完整技术文档。每个模块有独立文档，加上跨模块的专项文档。

## 导航

### 核心参考

| 文档 | 内容 |
|------|------|
| [前端接入指南](./frontend-guide.md) | 认证流程、分页约定、核心业务示例、错误码速查 |
| [API 端点表](./api-endpoints.md) | API 方法、路径、守卫和参数说明 |
| [API 参数校验规范](./api-validation.md) | 全局校验管道、DTO 编写规范、参数类型约束细则 |
| [后端架构与模块边界](./architecture.md) | 分层规则、事务 Outbox、API 契约和自动门禁 |
| [API 契约发布流程](./api-contract.md) | OpenAPI 事实源、版本、生成与客户端同步规则 |
| [Flutter / 原生移动端接入](./mobile-client-guide.md) | 安全存储、刷新、幂等、分页、媒体和 FCM |
| [Flutter 移动端界面与可读性契约](./mobile-ui-contract.md) | 字体、文字缩放、阅读列、原生导航、正文语义与视觉验收 |
| [数据模型](./data-model.md) | 表、枚举、字段说明和关系 |
| [图片上传管线](./image-upload.md) | 预签名上传 → S3 直传 → 确认 → sharp 缩略图 |
| [通知投递规则](./notification-delivery.md) | 7 类通知的触发条件和接收者矩阵 |

### 模块文档

| 文档 | 模块 | 职责 |
|------|------|------|
| [auth](./modules/auth.md) | 认证 | 注册、登录、Token 刷新、邮箱验证、改密码、找回密码 |
| [users](./modules/users.md) | 用户 | 资料、关注、拉黑、注销 |
| [economy](./modules/economy.md) | 等级与温油 | 经验等级、每日签到、打赏、钱包流水与公开统计 |
| [threads](./modules/threads.md) | 主题帖 | CRUD、成员管理、私密帖、邀请链接、置顶 |
| [subthreads](./modules/subthreads.md) | 子贴 | CRUD、排序、发帖权限策略 |
| [posts](./modules/posts.md) | 楼层 | 发帖、楼中楼、编辑、软删除、点赞、@提及 |
| [dice](./modules/dice.md) | 骰子 | 表达式协议、服务端投掷、结果不可变、草稿发布结算 |
| [drafts](./modules/drafts.md) | 草稿 | 用户级全局 5 槽位草稿池 |
| [notifications](./modules/notifications.md) | 通知 | 列表、未读数、已读 |
| [mobile-push](./modules/mobile-push.md) | 移动推送 | FCM token 绑定、队列投递、失效停用 |
| [direct-messages](./modules/direct-messages.md) | 私聊 | 一对一会话、消息请求、未读、归档与撤回 |
| [stickers](./modules/stickers.md) | 表情收藏 | 私有收藏夹、图片规范化、排序、最近使用与跨端发送协议 |
| [subscriptions](./modules/subscriptions.md) | 订阅 | THREAD/USER 订阅 + 通知投递 |
| [media](./modules/media.md) | 媒体 | 预签名 URL、upload-done、sharp 图片处理 |
| [tags](./modules/tags.md) | 标签 | 平台级 TopicTag 与主题帖关联 |
| [search](./modules/search.md) | 搜索 | PostgreSQL ILIKE 全文搜索 |
| [bookmarks](./modules/bookmarks.md) | 收藏 | 用户收藏主题帖，公开/私密帖 |
| [reports](./modules/reports.md) | 举报 | 公开目标举报、证据快照与原子结案 |
| [admin](./modules/admin.md) | 管理后台 | 数据看板、两级权限、用户处罚、内容处置、审计与系统通知 |
| [jobs](./modules/jobs.md) | 任务队列 | BullMQ 通知队列、图片处理队列、定时清理 |

## 快速查找

- **想知道某个 API 怎么调用？** → [API 端点表](./api-endpoints.md)
- **想知道某张表有哪些字段？** → [数据模型](./data-model.md)
- **想知道上传图片的完整流程？** → [图片上传管线](./image-upload.md)
- **Flutter 如何安全接入？** → [Flutter / 原生移动端接入](./mobile-client-guide.md)
- **Flutter 的字号、阅读宽度和移动布局怎么验收？** → [Flutter 移动端界面与可读性契约](./mobile-ui-contract.md)
- **想知道什么情况会收到通知？** → [通知投递规则](./notification-delivery.md)
