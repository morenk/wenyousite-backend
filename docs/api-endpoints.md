# API 端点表

> 全局前缀 `/api/v1`（开发环境）。无特殊说明时 `Guard` 为控制器级别默认值。

## 认证端点 (Auth)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/auth/register/request-code` | 无 | 注册第一步：请求邮箱验证码（限流 1/min） |
| POST | `/auth/register/verify-and-complete` | 无 | 注册第二步：验证码+用户名+密码（支持 X-Client-Platform 区分 web/mobile），完成注册（emailVerified=true，立即可用） |
| POST | `/auth/login` | 无 | 邮箱或用户名 + 密码登录，返回双 Token + 用户信息，创建独立设备会话。5 次失败锁定 15 分钟 |
| POST | `/auth/refresh` | 无 | 用 refreshToken 轮转换取新双 Token（含盗用检测） |
| POST | `/auth/verify-email` | AuthRead | 验证当前登录用户的邮箱（需登录 + 6 位验证码），限流 5/min |
| POST | `/auth/resend-verification` | 无 | 重发验证邮件（限流 1/min） |
| POST | `/auth/change-password` | AuthRead | 修改密码（需旧密码），成功后吊销全部 refresh token + 发送通知邮件 |
| POST | `/auth/forgot-password` | 无 | 发送找回密码邮件（限流 1/min） |
| POST | `/auth/change-email/request-code` | AuthRead | 更换邮箱第一步：校验当前密码后向新邮箱发验证码（限流 1/min） |
| POST | `/auth/change-email/verify` | Auth | 更换邮箱第二步：验证码确认，更新邮箱（限流 5/min） |
| POST | `/auth/reset-password` | 无 | 用邮件 + 验证码重置密码（需提供邮箱锚定身份），成功后吊销全部 refresh token（限流 5/min） |
| POST | `/auth/logout` | AuthRead | 登出，传入 refreshToken 撤销指定设备会话（Cookie 优先） |
| GET | `/auth/sessions` | AuthRead | 获取当前用户所有活跃会话列表 |
| DELETE | `/auth/sessions/:id` | AuthRead | 撤销指定会话（远程登出设备） |

## 用户端点 (Users)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/users/me` | AuthRead | 当前登录用户完整信息（含 email、隐私设置、关注/粉丝数） |
| PATCH | `/users/me` | Auth | 修改当前用户资料（用户名/Bio/隐私设置），5次/分钟，需邮箱已验证 |
| PATCH | `/users/me/avatar` | Auth | 设置头像（传入 mediaId），需邮箱已验证 |
| DELETE | `/users/me/avatar` | Auth | 移除头像（置空 `user.avatar`），需邮箱已验证 |
| DELETE | `/users/me` | Auth | 注销当前账号（软删除，设置 deletedAt），需邮箱已验证 |
| GET | `/users/search?q=xxx` | AuthRead | 搜索用户（@提及用），排除已注销 |
| GET | `/users/:id` | OptionalAuth | 用户公开资料（不含 email）。登录后附加 isFollowing / isFollowedBy / isBlocked / isBlockedBy |
| GET | `/users/:id/bookmarks` | OptionalAuth | 用户公开收藏，Cursor 分页（受 showBookmarks 控制） |
| GET | `/users/:id/played-threads` | OptionalAuth | 用户参与的帖子（被其他楼主标记为玩家，不含自建帖），按加入时间倒序，Cursor 分页（受 showPlayerBadges 控制） |
| GET | `/users/:id/created-threads` | OptionalAuth | 用户创建的帖子（本人可见全部含私密帖，他人仅见 PUBLIC），按创建时间倒序，Cursor 分页 |
| GET | `/users/:id/recent-replies` | OptionalAuth | 用户最近 10 条回复（含 content、preview、parentPostId），固定返回不分页（受 showRecentReplies 控制） |
| POST | `/users/follow/:id` | Auth | 关注用户，发送 follow 通知 |
| DELETE | `/users/follow/:id` | Auth | 取消关注 |
| GET | `/users/following` | AuthRead | 我的关注列表 |
| GET | `/users/followers` | AuthRead | 我的粉丝列表 |
| GET | `/users/:id/following` | OptionalAuth | 指定用户的关注列表（公开） |
| GET | `/users/:id/followers` | OptionalAuth | 指定用户的粉丝列表（公开） |
| POST | `/users/me/block/:id` | Auth | 拉黑用户 |
| DELETE | `/users/me/block/:id` | Auth | 取消拉黑 |
| GET | `/users/me/blocks` | AuthRead | 我的黑名单 |

## 主题帖端点 (Threads)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads` | Public | 主题帖列表（仅已发布帖），支持分区/排序/标签/Cursor，每帖含 `preview` 截断纯文本（源自默认子贴正文 kind=BODY） |
| POST | `/threads` | Auth | 创建主题帖草稿（事务内创建 Thread + OWNER + 默认子贴 + 可选正文 kind=BODY，published=false）。参数: title/category/content/subthreadTitle/tagNames/visibility 全部可选。每用户最多 10 条未发布草稿，超限返回 BAD_REQUEST |
| GET | `/threads/draft` | AuthRead | 我的草稿箱列表（未发布帖） |
| GET | `/threads/:id` | AuthRead | 详情（含子贴列表）。未发布帖仅 owner 可查看；已发布帖浏览量+1，PRIVATE 帖非成员 404 |
| PATCH | `/threads/:id` | Auth | 修改/发布（仅 OWNER/COLLABORATOR）。设置 published=true 即发布，此时校验 title/category/子贴/楼层完整性，发布后通知粉丝 |
| DELETE | `/threads/:id` | Auth | 删除（仅 OWNER）。未发布帖硬删除（级联），已发布帖软删除 |
| POST | `/threads/:id/like` | Auth | 点赞主题帖（幂等） |
| DELETE | `/threads/:id/like` | Auth | 取消点赞（幂等） |
| POST | `/threads/:id/invite-link` | Auth | 生成/刷新私密帖邀请链接（需已发布，仅 OWNER） |
| GET | `/threads/join-by-link/:token` | AuthRead | 预览邀请链接对应的私密帖概要（title / category / owner / memberCount，不创建成员） |
| POST | `/threads/join-by-link/:token` | Auth | 通过邀请链接加入私密帖（需已发布） |

## 成员端点 (Thread Members)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/members` | Public | 回复过帖子的人列表 |
| POST | `/threads/:id/members/join` | Auth | 自由加入（需已发布，PRIVATE 帖禁止） |
| PATCH | `/threads/:id/members/:userId` | Auth | 修改参与人 role/playerMarked（授予/收回玩家身份，仅 OWNER/COLLABORATOR），需邮箱已验证 |
| DELETE | `/threads/:id/members/me` | AuthRead | 主动退出，取消自己的玩家标记（OWNER 不可退出），需邮箱已验证 |
| DELETE | `/threads/:id/members/:userId` | Auth | 收回该参与人的玩家身份（仅 OWNER/COLLABORATOR），需邮箱已验证 |

## 子贴端点 (Subthreads)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/subthreads` | Public | 子贴列表（按 sortOrder 排序，过滤已软删除） |
| POST | `/threads/:id/subthreads` | Auth | 创建子贴（仅 OWNER/COLLABORATOR），标题必填正文可选，sortOrder 自动递增 |
| PUT | `/threads/:id/subthreads/reorder` | Auth | 批量重排子贴（拖拽排序），需保持默认子贴为第一位 |
| GET | `/subthreads/:id` | Public | 子贴详情 |
| PATCH | `/subthreads/:id` | Auth | 修改子贴（仅 OWNER/COLLABORATOR），默认子贴不可修改 sortOrder |
| DELETE | `/subthreads/:id` | Auth | 软删除（仅 OWNER/COLLABORATOR） |

## 楼层端点 (Posts)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/subthreads/:id/posts` | Public | 楼层列表（Cursor 分页），只返回 kind=FLOOR（不含正文），主楼层 parentPostId=null，内嵌每个楼层前 3 条楼中楼回复 |
| POST | `/subthreads/:id/posts` | Auth | 发帖（创建楼层 kind=FLOOR，含楼中楼回复），需邮箱已验证，事务分配 floorNumber |
| PUT | `/subthreads/:id/body` | Auth | upsert 子贴正文（仅 OWNER/COLLABORATOR）：无正文创建 kind=BODY，有正文乐观锁更新（version 不匹配返回 409） |
| GET | `/posts/:id` | Public | 帖子详情 |
| GET | `/posts/:id/replies` | Public | 主楼层的楼中楼回复列表（Cursor 分页，createdAt + id 稳定正序；正文或回复 ID 返回 404） |
| PATCH | `/posts/:id` | Auth | 编辑（仅作者自己），需邮箱已验证，乐观锁 |
| DELETE | `/posts/:id` | Auth | 软删除楼层（仅作者，正文 kind=BODY 不可删），需邮箱已验证 |

## 草稿端点 (Drafts)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/drafts` | AuthRead | 当前用户草稿列表 |
| GET | `/drafts/:id` | AuthRead | 获取单条草稿 |
| POST | `/drafts` | Auth | 保存草稿（不传 slot 自动选 1-5 空闲位，满时 400），需邮箱已验证 |
| PATCH | `/drafts/:id` | Auth | 更新草稿内容，需邮箱已验证 |
| DELETE | `/drafts/:id` | Auth | 删除草稿，需邮箱已验证 |
| GET | `/drafts/slots` | AuthRead | 槽位使用情况（usedSlots / maxSlots） |

## 通知端点 (Notifications)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/notifications?cursor=&type=` | AuthRead | 通知列表（Cursor 分页，支持 type 过滤），含关联 post/thread/fromUser |
| GET | `/notifications/unread` | AuthRead | 未读通知数 |
| PATCH | `/notifications/:id` | AuthRead | 标记单条通知阅读状态（Body: { isRead: boolean }） |
| DELETE | `/notifications/:id` | AuthRead | 硬删除单条通知 |
| POST | `/notifications/read-all` | AuthRead | 一键全部已读 |

## 订阅端点 (Subscriptions)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/subscriptions` | AuthRead | 我的订阅列表 |
| POST | `/subscriptions` | Auth | 创建订阅 (type=THREAD/USER, USER 需 targetUserId)，需邮箱已验证 |
| DELETE | `/subscriptions/:id` | Auth | 取消订阅，需邮箱已验证 |

## 媒体端点 (Media)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/media/upload-url` | Auth | 获取预签名上传 URL + mediaId（预建 UPLOADING 记录），需邮箱已验证 |
| POST | `/media/upload-done` | Auth | 确认上传完成（传 mediaId），校验归属 + S3 对象，入队处理，需邮箱已验证 |
| GET | `/media/:id` | Auth | 查询图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED），需邮箱已验证 |

## 收藏端点 (Bookmarks)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/bookmarks` | AuthRead | 我的收藏列表（Cursor 分页），仅返回我仍可访问的帖 |
| POST | `/bookmarks` | AuthRead | 收藏主题帖。PRIVATE 帖仅成员可收藏 |
| DELETE | `/bookmarks/:id` | AuthRead | 取消收藏 |

## 其他端点

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/search?q=xxx` | Public | 全文搜索（POST 正文 + Thread 标题，ILIKE） |
| GET | `/tags` | Public | 搜索标签 |
| POST | `/tags` | Auth | 创建标签，需邮箱已验证 |
| GET | `/reading-progress` | AuthRead | 所有子贴阅读进度 |
| GET | `/reading-progress/new-replies?subthreadId=` | AuthRead | 某子贴新增回复数 |
| POST | `/reading-progress` | AuthRead | 记录/更新阅读进度 |
| POST | `/reports` | Auth | 提交举报（已搁置），需邮箱已验证 |
| GET | `/reports` | AuthRead | 举报列表（管理员，已搁置） |
| PATCH | `/reports/:id/handle` | Auth | 处理举报（管理员，已搁置），需邮箱已验证 |
| GET | `/admin` | Public | 管理后台入口 |
| POST | `/admin/notifications/system` | JWT + Verified + Admin | 发送系统通知。Body: content(必填) + 可选 payload/recipientIds/conditions/threadId |
| POST | `/admin/notifications/system/preview` | JWT + Verified + Admin | 预览接收者人数（不发），复用发送 DTO |
| GET | `/admin/notifications/system/history` | JWT + Verified + Admin | 系统通知发送历史（cursor 分页） |
| GET | `/admin/users/search?q=` | JWT + Verified + Admin | 用户搜索（用户名或邮箱），供管理员选择接收者 |
| GET | `/health` | 无 | 健康检查 |
