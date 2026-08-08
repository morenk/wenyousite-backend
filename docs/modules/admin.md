# 管理后台后端

## 权限模型

所有管理接口使用统一 `@AdminAuth()`，要求 JWT、已验证邮箱以及 `ADMIN` 或 `SUPER_ADMIN`。Controller 不手写角色判断。

- `ADMIN`：举报读取/结案、内容处置、普通用户处罚、系统通知、分类与标签配置。
- `SUPER_ADMIN`：包含全部管理员能力，并可处罚 `ADMIN`、授予或撤销 `ADMIN`。
- 不允许处罚自己或任何 `SUPER_ADMIN`；HTTP API 不允许授予 `SUPER_ADMIN`。
- 首个超级管理员通过 `pnpm admin:bootstrap -- --email=...` 从已验证账号初始化；已有超级管理员时命令拒绝执行。

## 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin` | 返回当前角色派生的能力列表 |
| `GET` | `/admin/users` | 按关键词、角色、处罚状态游标分页 |
| `GET` | `/admin/users/:id` | 用户和当前有效处罚详情 |
| `POST` | `/admin/users/:id/sanctions` | 临时暂停或永久封禁 |
| `POST` | `/admin/users/:id/sanctions/current/revoke` | 解除当前处罚 |
| `PATCH` | `/admin/users/:id/role` | `SUPER_ADMIN` 授予/撤销 `ADMIN` |
| `POST` | `/admin/content/:type/:id/hide` | 隐藏公开 `thread/post` |
| `POST` | `/admin/content/:type/:id/restore` | 恢复由站务隐藏的内容 |
| `GET` | `/admin/audit-logs` | 按动作、管理员、目标和时间游标分页 |
| `GET` | `/admin/dashboard/overview` | 当前/上一等长周期、DAU/WAU/MAU 和治理快照 |
| `GET` | `/admin/dashboard/timeseries` | 注册、活跃、发帖和举报的按日连续时间序列 |
| `GET` | `/admin/dashboard/distributions` | 角色、举报、分区和有效处罚分布 |
| `GET / POST` | `/admin/thread-categories` | 列出（含停用项）或新增主题帖分类 |
| `PATCH` | `/admin/thread-categories/:id` | 编辑、排序或停用主题帖分类；slug 创建后不可修改 |
| `GET / POST` | `/admin/tags` | 列出（含停用项）或新增平台标签 |
| `PATCH` | `/admin/tags/:id` | 编辑、排序或停用平台标签 |

系统通知的发送、预览、历史与用户搜索路径保持 `/admin/notifications/system*`、`/admin/users/search` 不变，也使用相同管理员认证。

## 数据看板口径

- `overview` 与 `timeseries` 接受可选 `from/to=YYYY-MM-DD`，均为北京时间闭区间；默认最近 30 天，最长 366 天。
- 概览中的 `previous` 是紧邻当前区间、长度相同的上一周期；前端可据此计算环比，避免在多个客户端重复定义时间边界。
- DAU/WAU/MAU 分别为当天、最近 7 天、最近 30 天出现过成功产品请求的去重普通用户。管理员、匿名、失败请求、管理接口和通知轮询不计入。
- `newPosts` 只统计 `FLOOR` 楼层，不包含每个子贴的 `BODY` 正文；主题帖按 `publishedAt` 统计，举报处理按 `handledAt` 统计。
- 固定枚举分布返回完整桶；主题帖分类分布从分类配置表读取并保留零值项，顺序与管理员配置一致。

## 处罚与内容处置

- `SUSPENSION` 必须提供未来结束时间；`BAN` 永久生效。处罚不自动隐藏用户历史内容。
- 生效处罚会在同一事务吊销目标所有 Refresh Token。登录、刷新和每次 JWT 身份加载都会检查处罚，因此旧 Access Token 也立即失效。
- 过期暂停自动视为无效；历史处罚记录不删除。暂停可升级为封禁，封禁必须先明确解除才能改为较轻处罚。
- 主题帖和帖子继续使用 `deletedAt` 控制可见性，同时用 `removalSource` 区分作者、帖内管理者和站务动作。只有 `ADMIN` 来源可以从后台恢复。
- 隐藏主题帖同步移除 Redis 排序/统计投影；恢复会重建投影。帖子处置复用现有缓存失效事件。

## 审计

所有治理和分类/标签配置写操作通过统一 `AuditService` 写不可变 `audit_logs`，记录 actor、动作、目标、举报、理由、脱敏 metadata、IP 和 request ID。状态与审计同事务提交；日志没有修改或删除接口。
