# 举报与结案

## 概述

举报模块覆盖公开社区中的用户、主题帖和帖子。用户提交时保存脱敏证据快照；管理员通过独立的 `/admin/reports` 队列一次完成驳回或“结案 + 可选处置”。私聊和私密帖不在当前范围内。

## API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/reports` | Verified | 提交 `USER / THREAD / POST` 举报；每账号每分钟最多 5 次 |
| `GET` | `/admin/reports` | Admin | 按状态、目标类型、原因分类游标分页 |
| `GET` | `/admin/reports/:id` | Admin | 举报、证据快照与目标当前状态 |
| `POST` | `/admin/reports/:id/resolve` | Admin | 原子驳回或结案，并可选隐藏内容/暂停用户/封禁用户 |

旧的管理员 `GET /reports` 和 `PATCH /reports/:id/handle` 已移除，避免两套结案语义并存。

## 业务规则

- `ReportTargetType`: `USER / THREAD / POST`；目标必须是当前可见的公开社区对象，不能举报自己或自己发布的内容。
- `ReportStatus`: `PENDING / RESOLVED / DISMISSED`。同一举报只能结案一次，并发重复结案返回 `REPORT_ALREADY_HANDLED`。
- `ReportReasonCode`: `SPAM / HARASSMENT / HATE_OR_THREATS / SEXUAL_CONTENT / VIOLENT_CONTENT / PERSONAL_INFORMATION / ILLEGAL_CONTENT / OTHER`；`OTHER` 必须填写补充说明。
- 新举报保存 `snapshotVersion=1` 的目标快照。用户快照不保存邮箱，帖子快照保存当时正文以防编辑或删除破坏证据。
- 同一举报人对同一目标最多保留一条 `PENDING` 举报，由数据库部分唯一索引防并发重复。
- `DISMISSED` 不能携带处罚；`USER` 只允许暂停/封禁，`THREAD/POST` 只允许隐藏。
- 举报状态、关联处罚、会话吊销与审计记录在同一 Prisma 事务提交，失败时全部回滚。
