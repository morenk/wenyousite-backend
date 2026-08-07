# API 端点表

> 全局前缀 `/api/v1`（开发环境）。无特殊说明时 `Guard` 为控制器级别默认值。

## 认证端点 (Auth)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/auth/register/request-code` | 无 | 注册第一步：请求邮箱验证码（限流 1/min） |
| POST | `/auth/register/verify-and-complete` | 无 | 注册第二步：验证码+用户名+密码；按 `X-Client-Platform` 创建 Web 或移动端登录终端（emailVerified=true） |
| POST | `/auth/login` | 无 | 邮箱或用户名 + 密码登录并创建对应端登录终端；同端旧终端会被替换。5 次失败锁定 15 分钟 |
| POST | `/auth/refresh` | 无 | 轮转 refresh token；平台沿用服务端记录，含并发宽限与盗用检测 |
| POST | `/auth/verify-email` | AuthRead | 验证当前登录用户的邮箱（需登录 + 6 位验证码），限流 5/min |
| POST | `/auth/resend-verification` | 无 | 重发验证邮件（限流 1/min） |
| POST | `/auth/change-password` | AuthRead | 修改密码（需旧密码），成功后吊销全部 refresh token + 发送通知邮件 |
| POST | `/auth/forgot-password` | 无 | 发送找回密码邮件（限流 1/min） |
| POST | `/auth/change-email/request-code` | AuthRead | 更换邮箱第一步：校验当前密码后向新邮箱发验证码（限流 1/min） |
| POST | `/auth/change-email/verify` | Auth | 更换邮箱第二步：验证码确认，更新邮箱（限流 5/min） |
| POST | `/auth/reset-password` | 无 | 用邮件 + 验证码重置密码（需提供邮箱锚定身份），成功后吊销全部 refresh token（限流 5/min） |
| POST | `/auth/logout` | AuthRead | 退出当前登录终端（refresh Cookie 优先） |
| GET | `/auth/sessions` | AuthRead | 获取 Web / 移动端活跃登录终端，最多各一个（独立限流 60/min） |
| DELETE | `/auth/sessions/:id` | AuthRead | 按稳定终端 ID 退出指定登录终端（独立限流 60/min） |

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
| GET | `/users/:id/played-threads` | OptionalAuth | 用户已获授玩家身份的非自建帖子，支持 `visibility=PUBLIC\|PRIVATE` 和 Cursor 分页；本人可见公开/私密帖，他人仅见公开帖（受 showPlayerBadges 控制） |
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
| GET | `/threads` | OptionalAuth | 主题帖列表（仅已发布帖），支持分区/排序/状态/标签/Cursor；`tagId` 精确筛选主题帖标签，兼容 `tag` 名称模糊筛选，每帖含 `preview` 截断纯文本（源自默认子贴正文 kind=BODY） |
| POST | `/threads` | Auth | 创建主题帖草稿（事务内创建 Thread + OWNER + 默认子贴 + 可选正文 kind=BODY，published=false）。参数: title/category/content/subthreadTitle/tagNames/visibility 全部可选。每用户最多 10 条未发布草稿，超限返回 BAD_REQUEST |
| GET | `/threads/draft` | AuthRead | 我的草稿箱列表（未发布帖） |
| GET | `/threads/:id` | OptionalAuth | 详情（含子贴列表）。公开已发布帖允许匿名访问；未发布帖仅 owner 可查看；已发布帖浏览量+1，PRIVATE 帖非成员 404；登录时附加收藏/点赞、`currentMembership` 与 `capabilities` |
| PATCH | `/threads/:id` | Auth | OWNER/COLLABORATOR 可修改标题、分区、状态等；visibility、published 仅 OWNER，已发布帖不可撤回草稿 |
| PATCH | `/threads/:id/aggregate` | Auth | 原子保存元数据、默认子贴标题/正文、标签及发布状态，统一校验乐观锁并结算发布骰子 |
| DELETE | `/threads/:id` | Auth | 删除（仅 OWNER）。未发布帖硬删除（级联），已发布帖软删除 |
| POST | `/threads/:id/like` | Auth | 点赞主题帖（幂等） |
| DELETE | `/threads/:id/like` | Auth | 取消点赞（幂等） |
| POST | `/threads/:id/invite-link` | Auth | 生成/刷新私密帖邀请链接（需已发布，仅 OWNER） |
| GET | `/threads/join-by-link/:token` | AuthRead | 预览邀请链接对应的私密帖概要并返回 `alreadyJoined`（不创建成员） |
| POST | `/threads/join-by-link/:token` | Auth | 幂等地通过邀请链接加入私密帖（需已发布，已加入时返回现有成员） |

## 成员端点 (Thread Members)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/members` | OptionalAuth | 回复过帖子的人列表；按主题帖可见性校验 |
| POST | `/threads/:id/members/join` | Auth | 旧客户端自由加入兼容端点（deprecated；Web 发言即参与） |
| PATCH | `/threads/:id/members/:userId` | Auth | OWNER 可任免协作者；OWNER/COLLABORATOR 可授予/收回玩家标记，需邮箱已验证 |
| DELETE | `/threads/:id/members/me` | AuthRead | 主动退出，取消自己的玩家标记（OWNER 不可退出），需邮箱已验证 |

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
| POST | `/subthreads/:id/posts` | Auth | 发帖（骰子节点内联在 content；楼层/楼中楼允许纯骰子），需邮箱已验证，事务分配 floorNumber 和正式骰子结果 |
| PUT | `/subthreads/:id/body` | Auth | upsert 子贴正文（骰子节点内联在 content；仅 OWNER/COLLABORATOR；已发布 BODY 必须有节点之外的正文） |
| GET | `/posts/:id` | Public | 帖子详情 |
| GET | `/posts/:id/replies` | Public | 主楼层的楼中楼回复列表（Cursor 分页，createdAt + id 稳定正序；正文或回复 ID 返回 404） |
| PATCH | `/posts/:id` | Auth | 编辑（仅作者自己；骰子节点移动保留、删除清理、同 ID 禁止改表达式），需邮箱已验证，乐观锁 |
| DELETE | `/posts/:id` | Auth | 软删除楼层（仅作者，正文 kind=BODY 不可删），需邮箱已验证 |

## 草稿端点 (Drafts)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/drafts` | AuthRead | 当前用户草稿列表 |
| GET | `/drafts/:id` | AuthRead | 获取单条草稿 |
| POST | `/drafts` | Auth | 原子保存完整 `content` 快照（含内联骰子节点；不传 slot 自动选空位），需邮箱已验证 |
| PATCH | `/drafts/:id` | Auth | 原子更新完整 content 快照，需邮箱已验证和 version |
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

## 私聊端点 (Direct Messages)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/direct-conversations?view=INBOX\|REQUESTS\|ARCHIVED&cursor=&limit=` | AuthRead | 本人的会话、待处理请求或归档列表，Cursor 分页 |
| POST | `/direct-conversations` | Auth | 发送首条纯文本/单图/收藏表情消息；互关直接接受，否则创建请求 |
| GET | `/direct-conversations/unread` | AuthRead | 已接受会话未读消息、待处理请求及合计 |
| GET | `/direct-conversations/by-user/:userId` | AuthRead | 查询与指定用户的联系状态及现有会话 |
| GET | `/direct-conversations/:id` | AuthRead | 会话详情，仅参与者可见 |
| GET | `/direct-conversations/:id/messages?cursor=&after=&limit=` | AuthRead | 历史或轮询增量消息，按时间正序；cursor 与 after 互斥 |
| POST | `/direct-conversations/:id/messages` | Auth | 向已接受会话发送纯文本/单图/收藏表情消息 |
| PATCH | `/direct-conversations/:id/request` | AuthRead | 接收方接受或拒绝请求；接受要求邮箱已验证 |
| PATCH | `/direct-conversations/:id/archive` | AuthRead | 归档或恢复当前用户的会话 |
| POST | `/direct-conversations/:id/read` | AuthRead | 标记实际展示到的锚点及之前消息为本人已读 |
| DELETE | `/direct-messages/:id` | AuthRead | 发送者十分钟内撤回；待处理首条撤回会取消请求 |

## 订阅端点 (Subscriptions)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/subscriptions` | AuthRead | 我的订阅列表 |
| POST | `/subscriptions` | Auth | 创建官方更新订阅（THREAD）或普通玩家回复订阅（USER）；帖内管理者无需且不可创建，需邮箱已验证 |
| DELETE | `/subscriptions/:id` | Auth | 取消订阅，需邮箱已验证 |

## 媒体端点 (Media)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/media/upload-url` | Auth | 获取预签名上传 URL + mediaId（预建 UPLOADING 记录），需邮箱已验证；**每用户小时配额（默认 60 次）**，超限返回 429 |
| POST | `/media/upload-done` | Auth | 幂等确认上传（传 mediaId），校验归属 + 对象实际大小/MIME，原子入队处理，需邮箱已验证 |
| GET | `/media/:id` | Auth | 查询图片处理状态（UPLOADING / PROCESSING / COMPLETED / FAILED），需邮箱已验证 |

## 表情收藏端点 (Stickers)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/stickers` | AuthRead | 获取私有收藏夹、最近 20 个和处理中的导入 |
| POST | `/stickers/imports/media` | Auth | 从本人已完成媒体导入，使用 UUID 幂等键 |
| POST | `/stickers/imports/direct-message` | Auth | 收藏本人参与且未撤回私聊中的图片或表情 |
| POST | `/stickers/imports/post-image` | Auth | 收藏当前可访问帖子正文中的指定站内图片或表情 |
| GET | `/stickers/imports/:id` | AuthRead | 查询导入处理状态 |
| PUT | `/stickers/reorder` | Auth | 使用收藏夹版本和完整 ID 列表原子重排 |
| DELETE | `/stickers/:favoriteId` | Auth | 移除自己的收藏，不影响已发送内容 |

## 收藏端点 (Bookmarks)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/bookmarks` | AuthRead | 我的收藏列表（Cursor 分页），仅返回我仍可访问的帖 |
| POST | `/bookmarks` | AuthRead | 收藏主题帖。PRIVATE 帖仅成员可收藏 |
| DELETE | `/bookmarks/:id` | AuthRead | 取消收藏 |

## 其他端点

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/search/threads?q=xxx` | Public | 按需搜索公开主题帖标题，最多 50 条 |
| GET | `/search/users?q=xxx` | Public | 按需搜索未注销用户名，最多 20 条 |
| GET | `/search/posts?q=xxx&cursor=&limit=20` | Public | 按需搜索公开楼层正文（至少 2 字符，相关度游标分页，每帖最多 3 条） |
| GET | `/threads/:threadId/search/posts?q=xxx&cursor=&limit=20` | OptionalAuth | 搜索本帖全部子贴的楼层与楼中楼（至少 2 字符，继承主题帖访问权限） |
| GET | `/search?q=xxx` | Public | 兼容旧客户端的聚合搜索；单字符不扫描楼层正文 |
| GET | `/tags` | Public | 搜索标签 |
| POST | `/tags` | Auth | 创建标签，需邮箱已验证 |
| POST | `/reports` | Auth | 提交举报（已搁置），需邮箱已验证 |
| GET | `/reports` | AuthRead | 举报列表（管理员，已搁置） |
| PATCH | `/reports/:id/handle` | Auth | 处理举报（管理员，已搁置），需邮箱已验证 |
| GET | `/admin` | Public | 管理后台入口 |
| POST | `/admin/notifications/system` | JWT + Verified + Admin | 发送系统通知。Body: content(必填) + 可选 payload/recipientIds/conditions/threadId |
| POST | `/admin/notifications/system/preview` | JWT + Verified + Admin | 预览接收者人数（不发），复用发送 DTO |
| GET | `/admin/notifications/system/history` | JWT + Verified + Admin | 系统通知发送历史（cursor 分页） |
| GET | `/admin/users/search?q=` | JWT + Verified + Admin | 用户搜索（用户名或邮箱），供管理员选择接收者 |
| GET | `/health` | 无 | 健康检查 |
