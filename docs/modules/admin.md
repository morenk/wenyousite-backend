# 管理后台后端

## 账号与安全边界

管理员身份继承一个已验证邮箱的温油账号，不维护第二套用户资料。超级管理员发送邀请，用户以普通 Web 登录接受后获得 `ADMIN`；数据库只允许一个 `SUPER_ADMIN`，其身份只能通过显式移交变更。

站务台使用独立的 HttpOnly Cookie 会话，普通用户 Bearer JWT 不能调用 `/admin/**`。登录需密码加邮件验证码；会话 30 分钟空闲失效、8 小时绝对失效，并限制每个管理员只有一个活动会话。账号管理、处罚、申诉推翻和运行开关等高风险操作还需最近 10 分钟内完成邮件 step-up。所有后台写请求同时校验 `X-CSRF-Token`。

前台与移动端的权力性功能使用独立的 `AdminBearerAuth` 边界：复用普通 Bearer 登录态并从数据库实时读取角色，只允许 `ADMIN / SUPER_ADMIN`，不要求独立站务会话、CSRF 或邮件 step-up。该边界只作用于明确声明的客户端权力接口，不放宽 `/admin/**`。

- `ADMIN`：案件、申诉、用户处罚、通知活动、分类标签、运行设置与审计读取。
- `SUPER_ADMIN`：包含全部管理员能力，并管理邀请、管理员撤销和超级管理员移交。
- 不允许处罚自己；普通管理员不能处罚管理员；任何管理员都不能处罚超级管理员。
- 首个超级管理员使用 `pnpm admin:bootstrap -- --email=...` 从已验证账号初始化。

## 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/admin/auth/challenge` | 校验账号密码并发送登录验证码 |
| `POST` | `/admin/auth/verify` | 验证验证码并建立独立站务会话 |
| `GET / POST` | `/admin/auth/session`、`/admin/auth/logout` | 获取或结束站务会话 |
| `POST` | `/admin/auth/step-up/challenge`、`/verify` | 高风险操作近期确认 |
| `GET` | `/admin/cases`、`/admin/cases/:id` | 案件队列与证据详情 |
| `POST` | `/admin/cases/:id/resolve` | 原子结案、处置并生成用户可见决定 |
| `GET / POST` | `/admin/appeals`、`/admin/appeals/:id/resolve` | 申诉复核、维持或推翻决定 |
| `GET` | `/admin/users`、`/admin/users/:id` | 用户与有效处罚 |
| `POST` | `/admin/users/:id/sanctions` | 临时暂停或永久封禁 |
| `POST` | `/admin/users/:id/sanctions/current/revoke` | 解除当前处罚 |
| `POST` | `/admin/content/:type/:id/hide`、`/restore` | 直接隐藏或恢复主题帖、帖子、动态及动态评论 |
| `POST` | `/moderation/content/:type/:id/hide` | 前台/移动端管理员以普通 Bearer 直接隐藏内容 |
| `GET` | `/admin/content/hidden` | 分页读取当前仍由管理员隐藏的内容及恢复可用状态 |
| `GET / POST` | `/admin/accounts`、`/admin/accounts/invites` | 管理员列表与邀请 |
| `DELETE` | `/admin/accounts/:id` | 撤销普通管理员身份和后台会话 |
| `POST` | `/admin/accounts/transfer-super-admin` | 移交唯一超级管理员身份 |
| `POST` | `/admin-invitations/:token/accept` | 当前普通 Web 账号接受邀请 |
| `GET` | `/admin/audit-logs`、`/admin/audit-logs/export` | 筛选审计轨迹或导出最多 10000 条安全 CSV |
| `GET` | `/admin/dashboard/*` | 概览、时间序列和分布统计 |
| `GET / POST / PATCH` | `/admin/thread-categories/*`、`/admin/tags/*` | 分类和标签注册表配置 |
| `GET / POST / DELETE` | `/admin/notification-campaigns/*` | 预览、排期、查询和取消站内通知活动 |
| `GET / PATCH` | `/admin/operations/settings` | 注册、内容写入和维护公告开关 |

完整方法、DTO 和错误响应以 `docs/api-endpoints.md` 与固定 OpenAPI 契约为准。

案件、申诉、用户、审计与通知活动列表均使用不透明游标分页；客户端必须把响应 `meta.cursor` 原样用于下一页，切换任一筛选条件后从第一页重新查询。案件支持状态、目标类型与举报原因组合筛选；申诉支持状态、目标类型与处置动作；用户支持关键词、角色与处罚状态；审计支持动作、目标类型、操作者、目标与时间区间；通知活动支持关键词、发送状态与跳转目标。可选查询参数保持向后兼容，未传时不缩小结果集。

主题帖分类以注册表管理：`slug` 创建后不可修改，作为主题帖外键和 Web/移动端契约中的稳定标识；管理员可随时修改名称、描述、颜色、排序和启停状态。更新分类会失效公开分类缓存，历史主题帖继续通过原 slug 关联并立即显示新的展示信息。

直接内容处置与案件结案复用同一个 `ModerationService`：隐藏只接受当前公开可见且尚未删除的内容，写入 `deletedAt / removalSource=ADMIN / removedById / removalReason`；恢复只接受由管理员隐藏的记录，且父级主题帖、子贴或动态仍须可见。两条路径都会原子写审计，并在提交后失效主题帖排行、楼层/回复或动态投影。作者主动删除的内容不能通过站务接口改写来源或恢复。

当前隐藏内容列表直接聚合四类内容表中 `removalSource=ADMIN` 且 `deletedAt` 非空的记录，不以历史审计动作推断当前状态，因此已经恢复的内容不会残留。列表按隐藏时间使用不透明游标分页；帖子或评论的父级仍不可见时返回 `canRestore=false` 与中文阻塞原因，管理员应先恢复父级内容。

## 案件、决定与申诉

同一目标的未结举报聚合为一个 `ModerationCase`。案件详情保留每份举报的原因、补充说明和提交时证据快照；结案写入 `ModerationDecision`，包含政策代码、公开说明、内部备注和实际动作。举报状态、隐藏内容或用户处罚、会话吊销、决定和审计在同一事务提交。

用户可通过普通 Bearer，或通过账号密码换取的 15 分钟申诉专用 Bearer，读取与自己有关的决定并在决定后 30 天内提交一次申诉。专用凭据不创建普通会话、不能刷新，也不能访问其他业务接口，因此暂停或封禁不会切断法定申诉路径。管理员维持决定时只记录复核结果；推翻时撤销该决定造成的隐藏或处罚，并保留原决定和复核轨迹，不覆盖历史。

## 数据看板与运行开关

- 看板日期使用北京时间闭区间；默认最近 30 天，最长 366 天。`previous` 是紧邻当前区间的等长上一周期。
- DAU/WAU/MAU 只统计成功产品请求中的普通用户；管理员、匿名、失败请求和通知轮询不计入。
- 注册暂停只阻止新账号注册；内容写入暂停阻止发帖、动态、私聊和上传。登录、举报、申诉与全部站务接口保持可用。
- 运行设置最多缓存 5 秒。维护公告只控制展示窗口，不隐式暂停服务。

## 审计与敏感上下文

治理写操作通过 `AuditService` 写不可变 `audit_logs`，记录 actor、动作、目标、理由和脱敏 metadata。永久审计事件不保存 IP 与 request ID；两者进入独立 `AuditSensitiveContext`，设置一年到期时间，避免把排障标识永久化。业务状态与审计同事务提交，且没有修改或删除审计事件的 API。CSV 导出复用 `csv-stringify`，输出 UTF-8 BOM 并启用公式注入转义。

## 通知活动

通知活动先按受众条件预估人数，再保存标题、正文、目标主题和发送时间。调度器每 30 秒领取到期活动，通过现有 BullMQ `notification` 队列按 500 人分批投递；`campaignId` 与稳定事件键保证重试不会重复写入通知。活动可在发送前取消，状态为 `SCHEDULED / SENDING / SENT / CANCELED / FAILED`。
