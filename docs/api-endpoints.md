# API 端点表

> 本文件由 `pnpm docs:generate` 从 OpenAPI 生成，请勿手工编辑。路径均位于 `/api/v1` 下。

## Health

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | public | 健康检查，返回各依赖服务状态 |

## Auth

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/auth/register/request-code` | public | 注册第一步：请求邮箱验证码（限流 1次/分钟） |
| POST | `/auth/register/verify-and-complete` | public | 注册第二步：验证邮箱 + 设置用户名密码，完成后立即建立账号会话 |
| POST | `/auth/login` | public | 邮箱或用户名 + 密码登录。5 次失败锁定 15 分钟 |
| POST | `/auth/refresh` | public | 用 refreshToken 轮转换取新双 Token（Cookie 优先，含盗用检测） |
| POST | `/auth/change-password` | authenticated | 修改密码（需旧密码），成功后退出全部登录终端 |
| POST | `/auth/forgot-password` | public | 忘记密码 — 发送重置邮件（限流 1次/分钟） |
| POST | `/auth/reset-password` | public | 用邮箱 + 验证码重置密码，成功后吊销全部 refresh token |
| POST | `/auth/change-email/request-code` | authenticated | 更换邮箱第一步：向新邮箱发送验证码（限流 1次/分钟） |
| POST | `/auth/change-email/verify` | authenticated | 更换邮箱第二步：验证码确认并更新邮箱 |
| POST | `/auth/logout` | authenticated | 登出：按 access token 的稳定终端 ID 撤销当前终端，旧客户端回退到 refresh token |
| GET | `/auth/sessions` | authenticated | 获取当前用户的 Web / 移动客户端活跃登录终端（限流 60 次/分钟） |
| DELETE | `/auth/sessions/{id}` | authenticated | 退出指定登录终端（限流 60 次/分钟） |

## Users

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/users/search` | authenticated | 搜索用户（@提及用） |
| GET | `/users/mention-candidates` | authenticated | 获取当前主题帖可艾特候选（关注的人 + 帖内标记玩家） |
| GET | `/users/me` | authenticated | 获取当前登录用户资料 |
| PATCH | `/users/me` | authenticated | 修改当前登录用户资料（5 次/分钟） |
| DELETE | `/users/me` | authenticated | 注销当前账号 |
| GET | `/users/me/collaborated-threads` | authenticated | 获取当前用户担任协作者的已发布主题帖（含公开与私密主题） |
| PATCH | `/users/me/avatar` | authenticated | 设置头像（传入 mediaId，校验归属和 COMPLETED 状态） |
| DELETE | `/users/me/avatar` | authenticated | 移除头像（置空 user.avatar，回到首字母占位） |
| PATCH | `/users/me/profile-cover` | authenticated | 设置个人主页双画幅背景图（电脑端 3:1、移动端 2:1） |
| DELETE | `/users/me/profile-cover` | authenticated | 移除个人主页背景图并恢复默认背景 |
| GET | `/users/{id}/bookmarks` | optional | 查看用户的收藏列表（受 showBookmarks 隐私开关控制） |
| GET | `/users/{id}/moment-bookmarks` | optional | 查看用户收藏的动态（受 showBookmarks 隐私开关控制） |
| GET | `/users/{id}/played-threads` | optional | 查看用户参与的帖子（仅已被授予玩家身份的帖子；他人仅可见公开帖） |
| GET | `/users/{id}/created-threads` | optional | 查看用户创建的主题帖（本人可见全部含私密帖，他人仅见 PUBLIC 已发布帖） |
| GET | `/users/{id}/activity-summary` | optional | 获取用户主页创作活动汇总 |
| GET | `/users/{id}/recent-replies` | optional | 查看用户最近 10 条回复（受 showRecentReplies 隐私开关控制） |
| GET | `/users/{id}` | optional | 获取指定用户的公开资料。登录后额外返回关注/拉黑关系 |
| POST | `/users/follow/{id}` | authenticated | 关注用户 |
| DELETE | `/users/follow/{id}` | authenticated | 取消关注 |
| GET | `/users/following` | authenticated | 我的关注列表 |
| GET | `/users/followers` | authenticated | 我的粉丝列表 |
| GET | `/users/{id}/following` | optional | 指定用户的关注列表 |
| GET | `/users/{id}/followers` | optional | 指定用户的粉丝列表 |
| POST | `/users/me/block/{id}` | authenticated | 拉黑用户 |
| DELETE | `/users/me/block/{id}` | authenticated | 取消拉黑 |
| GET | `/users/me/blocks` | authenticated | 我的黑名单 |

## Notifications

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/notifications` | authenticated | 通知列表 |
| GET | `/notifications/unread` | authenticated | 未读通知数 |
| PATCH | `/notifications/{id}` | authenticated | 标记通知阅读状态 |
| DELETE | `/notifications/{id}` | authenticated | 删除通知 |
| POST | `/notifications/read-all` | authenticated | 全部已读 |

## Mobile Devices

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| PUT | `/mobile/devices/current` | authenticated | 注册或更新当前原生移动登录终端的 FCM token |
| DELETE | `/mobile/devices/current` | authenticated | 注销当前原生移动登录终端的推送 |

## Bookmarks

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/bookmarks` | authenticated | 我的收藏列表（Cursor 分页） |
| POST | `/bookmarks` | authenticated | 收藏主题帖 |
| GET | `/bookmarks/folders` | authenticated | 获取我的主题帖收藏夹分类 |
| POST | `/bookmarks/folders` | authenticated | 新建主题帖收藏夹分类 |
| PATCH | `/bookmarks/{id}` | authenticated | 移动收藏到其他收藏夹 |
| DELETE | `/bookmarks/{id}` | authenticated | 取消收藏 |

## Threads

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/threads/draft` | authenticated | 我的草稿箱列表（未发布帖，仅自己可见） |
| GET | `/threads` | optional | 首页主题帖发现列表，排除已注销楼主的帖子 |
| POST | `/threads` | authenticated | 创建主题帖草稿（published=false）。在沙盒内逐步添加子贴/楼层后通过 PATCH 发布 |
| GET | `/threads/{id}` | optional | 主题帖详情（含 全部子贴列表 + 楼层数 + 参与人数） |
| PATCH | `/threads/{id}` | authenticated | 修改/发布主题帖（仅 OWNER/COLLABORATOR）。设置 published=true 发布，带乐观锁 version |
| DELETE | `/threads/{id}` | authenticated | 删除主题帖。未发布帖硬删除（级联），已发布帖软删除（仅 OWNER） |
| PATCH | `/threads/{id}/aggregate` | authenticated | 原子保存主题帖元数据、默认子贴标题/正文和标签，可同时发布草稿 |
| POST | `/threads/{id}/like` | authenticated | 点赞主题帖（幂等，不通知自己） |
| DELETE | `/threads/{id}/like` | authenticated | 取消点赞主题帖（幂等） |
| POST | `/threads/{id}/invite-link` | authenticated | 生成或刷新私密帖邀请链接（仅 OWNER，需已发布 + 私密帖） |
| GET | `/threads/join-by-link/{token}` | authenticated | 预览邀请链接对应的私密帖信息，并判断当前用户是否已加入 |
| POST | `/threads/join-by-link/{token}` | authenticated | 通过 16 位邀请 token 幂等加入私密帖（需已发布） |
| GET | `/threads/{threadId}/members` | optional | 获取主题帖参与人列表 |
| POST | `/threads/{threadId}/members/join` | authenticated | 自由加入主题帖（兼容旧客户端，Web 已改为发言时自动参与） |
| PATCH | `/threads/{threadId}/members/{userId}` | authenticated | 修改参与人角色或玩家标记（仅 OWNER/COLLABORATOR） |
| DELETE | `/threads/{threadId}/members/me` | authenticated | 主动退出主题帖（取消自己的玩家标记） |
| GET | `/threads/{threadId}/tags` | optional | 获取主题帖关联的标签列表 |
| POST | `/threads/{threadId}/tags` | authenticated | 为主题帖添加标签（仅 OWNER/COLLABORATOR） |
| DELETE | `/threads/{threadId}/tags/{tagId}` | authenticated | 移除主题帖的标签（仅 OWNER/COLLABORATOR） |

## Tags

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/tags` | public | 搜索主题帖标签（不传 q 返回全部） |
| POST | `/tags` | authenticated | 创建主题帖标签 |
| GET | `/tags/{id}` | public | 获取标签详情 |

## Stickers

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/stickers` | authenticated | 获取当前用户收藏、最近使用和处理中的表情 |
| POST | `/stickers/imports/media` | authenticated | 将自己已上传的站内图片导入表情收藏 |
| POST | `/stickers/imports/direct-message` | authenticated | 收藏私聊消息中的图片或表情 |
| POST | `/stickers/imports/post-image` | authenticated | 收藏可访问帖子正文中的站内图片或表情 |
| GET | `/stickers/imports/{id}` | authenticated | 查询单次表情导入处理状态 |
| PUT | `/stickers/reorder` | authenticated | 按完整 ID 列表手动重排收藏 |
| DELETE | `/stickers/{favoriteId}` | authenticated | 从自己的收藏夹移除表情 |

## Thread Categories

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/thread-categories` | public | 获取管理员配置的可用主题帖分类 |

## Moments

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/moments` | optional | 动态瀑布流；发现与关注均按最后回复时间顶帖 |
| POST | `/moments` | authenticated | 发布纯文本/图片动态，最多 9 张图片 |
| GET | `/moments/bookmarks` | authenticated | 当前用户收藏的动态 |
| GET | `/moments/bookmark-folders` | authenticated | 获取我的动态收藏夹分类 |
| POST | `/moments/bookmark-folders` | authenticated | 新建动态收藏夹分类 |
| GET | `/moments/{id}` | optional | 获取动态详情 |
| PATCH | `/moments/{id}` | authenticated | 编辑自己的动态，使用 version 乐观锁 |
| DELETE | `/moments/{id}` | authenticated | 软删除动态 |
| POST | `/moments/{id}/like` | authenticated | 点赞动态，幂等 |
| DELETE | `/moments/{id}/like` | authenticated | 取消点赞动态，幂等 |
| POST | `/moments/{id}/bookmark` | authenticated | 收藏动态，幂等 |
| PATCH | `/moments/{id}/bookmark` | authenticated | 移动动态收藏到其他收藏夹 |
| DELETE | `/moments/{id}/bookmark` | authenticated | 取消收藏动态，幂等 |
| GET | `/moments/{id}/comments` | optional | 主评论列表，支持顺序与作者筛选并内嵌最早三条楼中楼 |
| POST | `/moments/{id}/comments` | authenticated | 发表文字、单图或单表情评论；回复统一归入两层楼中楼 |
| GET | `/moments/{id}/comment-authors` | optional | 获取当前可见动态回复串中的作者候选 |
| GET | `/moments/{id}/comments/{commentId}/context` | optional | 按评论 ID 获取动态主评论与精确定位目标 |
| GET | `/moments/{id}/comments/{commentId}/replies` | optional | 分页获取某主评论的楼中楼，支持顺序与作者筛选 |
| DELETE | `/moments/{id}/comments/{commentId}` | authenticated | 评论作者、动态作者或管理员软删除评论 |
| GET | `/users/{id}/moments` | optional | 用户公开动态列表 |

## Subthreads

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/threads/{threadId}/subthreads` | optional | 获取主题帖下的子贴列表 |
| POST | `/threads/{threadId}/subthreads` | authenticated | 创建子贴（仅 OWNER/COLLABORATOR） |
| GET | `/subthreads/{id}` | optional | 获取子贴详情 |
| PATCH | `/subthreads/{id}` | authenticated | 修改子贴（仅 OWNER/COLLABORATOR） |
| DELETE | `/subthreads/{id}` | authenticated | 删除子贴（仅 OWNER/COLLABORATOR） |
| PUT | `/threads/{threadId}/subthreads/reorder` | authenticated | 批量重排子贴（拖拽排序）。默认子贴必须在第一位 |

## Posts

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/threads/{threadId}/posts/latest` | optional | 定位主题帖内最新发布的楼层或楼中楼回复 |
| GET | `/subthreads/{subthreadId}/posts` | optional | 获取子贴的楼层列表（Cursor 分页） |
| POST | `/subthreads/{subthreadId}/posts` | authenticated | 发帖（创建新楼层或楼中楼回复） |
| GET | `/subthreads/{subthreadId}/posts/authors` | optional | 获取当前子贴中实际发布过主楼层的角色作者候选 |
| GET | `/posts/{id}/replies` | optional | 获取楼中楼回复列表（支持顺序与玩家/楼主/协作者筛选） |
| GET | `/posts/{id}/replies/authors` | optional | 获取当前楼层下实际回复过的角色作者候选 |
| PUT | `/subthreads/{subthreadId}/body` | authenticated | 写入子贴正文（upsert：无正文创建，有正文乐观锁更新）。仅 OWNER/COLLABORATOR |
| GET | `/posts/{id}` | optional | 获取帖子详情 |
| PATCH | `/posts/{id}` | authenticated | 编辑帖子 |
| DELETE | `/posts/{id}` | authenticated | 软删除楼层（子贴正文 kind=BODY 不可删除） |

## Drafts

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/drafts` | authenticated | 当前用户全部草稿 |
| POST | `/drafts` | authenticated | 保存草稿（不传 slot 自动选空闲位） |
| GET | `/drafts/slots` | authenticated | 草稿位使用情况（5 槽已用数） |
| GET | `/drafts/state` | authenticated | 原子获取草稿列表与槽位使用情况 |
| GET | `/drafts/{id}` | authenticated | 获取单条草稿 |
| PATCH | `/drafts/{id}` | authenticated | 更新草稿内容 |
| DELETE | `/drafts/{id}` | authenticated | 删除草稿 |

## Subscriptions

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/subscriptions` | authenticated | 我的订阅列表 |
| POST | `/subscriptions` | authenticated | 创建官方更新或玩家发言订阅 |
| DELETE | `/subscriptions/{id}` | authenticated | 取消订阅 |

## Reports

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/reports` | authenticated | 提交社区内容、用户或自己收到的私聊消息举报（Web/移动端兼容） |

## Admin Reports

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/reports` | admin | 管理员举报队列 |
| GET | `/admin/reports/{id}` | admin | 管理员举报详情 |
| POST | `/admin/reports/{id}/resolve` | admin | 原子结案并可选执行治理动作 |

## Admin Auth

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/admin/auth/challenge` | public | 管理员密码校验后发送邮箱二次验证码 |
| POST | `/admin/auth/verify` | public | 验证管理员验证码并建立独立管理员 Cookie 会话 |
| GET | `/admin/auth/session` | admin | 读取并续活当前管理员会话，同时轮发 CSRF token |
| POST | `/admin/auth/logout` | admin | 撤销当前管理员会话 |
| POST | `/admin/auth/step-up/challenge` | admin | 为高风险站务操作发送邮箱确认码 |
| POST | `/admin/auth/step-up/verify` | admin | 确认高风险操作，10 分钟内免重复验证 |

## Admin Accounts

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/accounts` | admin | 管理员账号、会话和待处理邀请 |
| POST | `/admin/accounts/invites` | admin | 邀请现有温油账号成为管理员 |
| DELETE | `/admin/accounts/invites/{id}` | admin | 取消待处理管理员邀请 |
| DELETE | `/admin/accounts/{id}` | admin | 撤销普通管理员身份并注销其会话 |
| POST | `/admin/accounts/transfer-super-admin` | admin | 把唯一超级管理员身份移交给另一名管理员 |
| POST | `/admin-invitations/{token}/accept` | authenticated | 当前温油账号接受管理员邀请（Web） |

## Admin Cases

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/cases` | admin | 按同一目标聚合后的治理案件队列 |
| GET | `/admin/cases/{id}` | admin | 案件证据、举报人、决定和申诉轨迹 |
| POST | `/admin/cases/{id}/resolve` | admin | 以公开说明和规则分类原子结案 |

## Admin Appeals

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/appeals` | admin | 申诉处理队列 |
| POST | `/admin/appeals/{id}/resolve` | admin | 维持或推翻治理决定；推翻会恢复内容或解除处罚 |

## Moderation Appeals

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/moderation/appeal-token` | public | 校验账号密码并签发 15 分钟申诉专用凭据 |
| GET | `/moderation/decisions/mine` | appeal | 以普通或申诉专用凭据读取近 30 天本人治理决定 |
| POST | `/moderation/appeals` | appeal | 以普通或申诉专用凭据对本人治理决定提交一次申诉 |

## Admin Operations

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/operations/settings` | admin | 读取注册、内容写入和维护公告状态 |
| PATCH | `/admin/operations/settings` | admin | 更新紧急开关和定时维护公告 |

## Admin Campaigns

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/notification-campaigns` | admin | 定时站内通知历史和状态 |
| POST | `/admin/notification-campaigns` | admin | 新建立即或定时发送的站内通知 |
| POST | `/admin/notification-campaigns/preview` | admin | 预估通知接收人数 |
| DELETE | `/admin/notification-campaigns/{id}` | admin | 取消尚未开始发送的通知计划 |

## Admin

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin` | admin | 当前管理员能力 |
| POST | `/admin/notifications/system` | admin | 发送系统通知（管理员，手动指定 / 条件筛选 / 全站广播） |
| POST | `/admin/notifications/system/preview` | admin | 预览系统通知接收者人数 |
| GET | `/admin/notifications/system/history` | admin | 系统通知发送历史 |
| GET | `/admin/users/search` | admin | 用户搜索（管理员用） |

## Admin Moderation

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/users` | admin | 管理员用户列表 |
| GET | `/admin/users/{id}` | admin | 管理员用户详情 |
| POST | `/admin/users/{id}/sanctions` | admin | 暂停或永久封禁用户 |
| POST | `/admin/users/{id}/sanctions/current/revoke` | admin | 解除用户当前处罚 |
| PATCH | `/admin/users/{id}/role` | admin | 撤销管理员角色；授予请使用邀请流程（超级管理员） |
| POST | `/admin/content/{type}/{id}/hide` | admin | 隐藏主题帖、帖子、动态或动态评论 |
| GET | `/admin/content/hidden` | admin | 当前仍由管理员隐藏的内容列表 |
| POST | `/admin/content/{type}/{id}/restore` | admin | 恢复由管理员隐藏的主题帖、帖子、动态或动态评论 |
| GET | `/admin/audit-logs` | admin | 管理员审计日志 |
| GET | `/admin/audit-logs/export` | admin | 按当前筛选导出管理员审计日志 CSV（最多 10000 条） |

## Client Moderation

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/moderation/content/{type}/{id}/hide` | authenticated | 管理员在前台或移动端直接隐藏内容，无需独立站务会话 |

## Admin Dashboard

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/dashboard/overview` | admin | 管理看板概览、环比区间和 DAU/WAU/MAU |
| GET | `/admin/dashboard/timeseries` | admin | 管理看板按日时间序列 |
| GET | `/admin/dashboard/distributions` | admin | 用户、举报、内容和处罚分布 |

## Admin Taxonomy

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/thread-categories` | admin | 管理员主题帖分类列表（含停用项） |
| POST | `/admin/thread-categories` | admin | 新增主题帖分类 |
| PATCH | `/admin/thread-categories/{id}` | admin | 编辑、排序或停用主题帖分类 |
| GET | `/admin/tags` | admin | 管理员标签列表（含停用项） |
| POST | `/admin/tags` | admin | 新增平台标签 |
| PATCH | `/admin/tags/{id}` | admin | 编辑、排序或停用平台标签 |

## Search

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/search/moments` | optional | 按标题和纯文本正文搜索公开动态 |
| GET | `/search/threads` | public | 按标题搜索公开主题帖 |
| GET | `/search/users` | public | 按用户名搜索未注销用户 |
| GET | `/search/posts` | public | 按正文搜索公开楼层与楼中楼 |
| GET | `/search` | public | 兼容聚合搜索（用户名 + 主题帖标题 + 楼层内容） |
| GET | `/threads/{threadId}/search/posts` | optional | 按正文搜索单个主题帖内的楼层与楼中楼 |

## Media

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/media/upload-url` | authenticated | 获取临时上传 URL + mediaId（有效期 10 分钟，预建 UPLOADING 记录） |
| POST | `/media/upload-done` | authenticated | 确认上传完成（校验归属 + S3，入队异步图片处理） |
| POST | `/media/{id}/upload-url` | authenticated | 为同一 UPLOADING 媒体重新签发临时上传地址 |
| GET | `/media/{id}` | authenticated | 查询图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED） |

## Direct Messages

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/direct-conversations` | authenticated | 私聊会话列表（主列表 / 消息请求 / 归档） |
| POST | `/direct-conversations` | authenticated | 向用户发送首条消息；互关直达，否则创建消息请求 |
| GET | `/direct-conversations/unread` | authenticated | 私聊未读消息数与待处理请求数 |
| GET | `/direct-conversations/by-user/{userId}` | authenticated | 查询与指定用户的现有会话及可联系状态 |
| GET | `/direct-conversations/{id}` | authenticated | 私聊会话详情 |
| GET | `/direct-conversations/{id}/messages` | authenticated | 私聊消息历史或轮询增量；响应按时间正序 |
| POST | `/direct-conversations/{id}/messages` | authenticated | 向已接受的私聊会话发送消息 |
| PATCH | `/direct-conversations/{id}/request` | authenticated | 接受或拒绝收到的消息请求 |
| PATCH | `/direct-conversations/{id}/archive` | authenticated | 归档或恢复自己的会话 |
| POST | `/direct-conversations/{id}/read` | authenticated | 标记当前用户实际看到的消息为已读，不向发件人暴露回执 |
| DELETE | `/direct-messages/{id}` | authenticated | 发送者在 10 分钟内撤回消息；待处理首条消息会取消请求 |

## Meta

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/meta` | public |  |

## Wallet

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/wallet` | authenticated | 获取当前用户温油钱包余额与收款统计 |
| POST | `/wallet/check-in` | authenticated | 按北京时间自动签到；每日幂等获得 1–3 升温油和 2 经验 |
| GET | `/wallet/transactions` | authenticated | 获取当前用户温油收支流水 |
| POST | `/threads/{id}/tips` | authenticated | 向已发布主题帖楼主打赏温油 |
| POST | `/users/{id}/tips` | authenticated | 直接向用户打赏温油 |
| POST | `/moments/{id}/tips` | authenticated | 给公开动态作者加油 |
