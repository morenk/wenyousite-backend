# 管理后台

## 概述

管理后台模块提供系统通知的发送、预览、历史查询，以及用户搜索功能。需 JWT 登录、邮箱验证，且角色为 ADMIN 或 SUPER_ADMIN。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Notification` | 复用，系统通知 `fromUserId` 为 null |
| `audit_logs` | 每次发送系统通知时写入审计记录 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/admin` | 无 | 管理后台入口，返回服务名、状态、文档地址 |
| `POST` | `/admin/notifications/system` | JWT + Verified + Admin | 发送系统通知。Body: content(必填) + 可选 payload / recipientIds / conditions / threadId |
| `POST` | `/admin/notifications/system/preview` | JWT + Verified + Admin | 预览接收者人数（复用发送 DTO，仅统计不发送） |
| `GET` | `/admin/notifications/system/history` | JWT + Verified + Admin | 系统通知发送历史（cursor 分页，默认 20 条/页） |
| `GET` | `/admin/users/search?q=` | JWT + Verified + Admin | 用户搜索（用户名或邮箱模糊匹配），供管理员手动选择接收者 |

## 核心业务规则

### 发送系统通知

支持三种分发模式（优先级从高到低）：

1. **手动指定用户**：传入 `recipientIds: string[]`，自动过滤已注销用户
2. **条件筛选**：传入 `conditions` 对象，支持以下字段组合（AND 逻辑）：
   - `role`: 角色筛选（USER / ADMIN / SUPER_ADMIN）
   - `emailVerified`: 邮箱验证状态
   - `createdAfter` / `createdBefore`: 注册时间范围
3. **全站广播**：不传 `recipientIds` 也不传 `conditions`，发送给所有未注销用户

所有模式均通过游标分页遍历目标用户（500 人/批），分批入 BullMQ `notification` 队列异步创建。
`fromUserId` 不传（= null），前端据此区分系统通知与社交通知。

### 审计日志

每次发送成功后在 `audit_logs` 表写入记录：
- `action`: `SYSTEM_NOTIFICATION`
- `targetType`: `USER`
- `detail`: JSON（通知内容摘要 + 接收者人数 + 筛选条件）
- `adminId`: 操作管理员 ID
- `ip`: 操作 IP

### 预览

`POST /admin/notifications/system/preview` 与发送接口复用同一 DTO，仅执行 COUNT 查询，不创建任何通知。

### 通知历史

查询 `notifications` 表中 `type='system'` 的记录，按创建时间倒序游标分页。

## 设计决策

- 系统通知不拆分独立表/接口，通过 `fromUserId: null` 在现有 Notification 表中共存，减少前端适配成本
- 全站广播分批入队而非单次批量插入，避免大用户量下队列任务超时
- 条件筛选使用简单的字段组合（AND 逻辑），不引入复杂 DSL，满足 admin 后台常见需求
- 用户搜索与业务侧 `/users/search` 分离，admin 版本返回 email/role 等敏感字段
- 管理员端点独立于各业务模块，后续管理操作（用户管理、审核等）可逐步迁移至此
