# 管理后台

## 概述

管理后台模块提供系统通知发送功能（指定用户或全站广播），以及服务状态入口。需 JWT 登录、邮箱验证，且角色为 ADMIN 或 SUPER_ADMIN。

## 涉及的模型

（复用 Notification 模型，系统通知 `fromUserId` 为 null）

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/admin` | 无 | 管理后台入口，返回服务名、状态、文档地址 |
| `POST` | `/admin/notifications/system` | JWT + Verified + Admin | 发送系统通知。Body: content(必填) + 可选 payload / recipientIds / threadId。recipientIds 为空则全站广播，分批写入 |

## 核心业务规则

- 系统通知通过 `NotificationProducer` 入队 `notification` 队列异步批量创建，与普通通知共用同一通知列表
- `fromUserId` 不传（= null），前端据此区分系统通知与社交通知
- 指定用户：校验传入 ID 是否对应未注销用户，过滤无效 ID
- 全站广播：游标分页遍历所有 `deletedAt = null` 的用户（500 条/批），分批入队
- 通知正文 `content` 为纯文本，`payload` 为可选结构化 JSON（如跳转链接）
- 系统通知支持用户删除（与其他通知一致），定时清理同普通通知规则

## 设计决策

- 系统通知不拆分独立表/接口，通过 `fromUserId: null` 在现有 Notification 表中共存，减少前端适配成本
- 全站广播分批入队而非单次批量插入，避免大用户量下队列任务超时
- 管理员端点独立于各业务模块，后续管理操作（用户管理、审核等）可逐步迁移至此
