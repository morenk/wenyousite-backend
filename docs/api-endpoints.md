# API 端点表

> 全局前缀 `/api/v1`（开发环境）。无特殊说明时 `Guard` 为控制器级别默认值。

## 认证端点 (Auth)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/auth/register/request-code` | 无 | 注册第一步：请求邮箱验证码（限流 1/min） |
| POST | `/auth/register/verify-and-complete` | 无 | 注册第二步：验证码+用户名+密码（支持 X-Client-Platform 区分 web/mobile），完成注册（emailVerified=false，只读态） |
| POST | `/auth/login` | 无 | 邮箱+密码登录，返回双 Token + 用户信息，创建独立设备会话。5 次失败锁定 15 分钟 |
| POST | `/auth/refresh` | 无 | 用 refreshToken 轮转换取新双 Token（含盗用检测） |
| POST | `/auth/verify-email` | AuthRead | 验证当前登录用户的邮箱（需登录 + 6 位验证码），限流 5/min |
| POST | `/auth/resend-verification` | 无 | 重发验证邮件（限流 1/min） |
| POST | `/auth/change-password` | AuthRead | 修改密码（需旧密码），成功后吊销全部 refresh token |
| POST | `/auth/forgot-password` | 无 | 发送找回密码邮件（限流 1/min） |
| POST | `/auth/reset-password` | 无 | 用邮件 + 验证码重置密码（需提供邮箱锚定身份），成功后吊销全部 refresh token（限流 5/min） |
| POST | `/auth/logout` | AuthRead | 登出，传入 refreshToken 撤销指定设备会话（Cookie 优先） |
| GET | `/auth/sessions` | AuthRead | 获取当前用户所有活跃会话列表 |
| DELETE | `/auth/sessions/:id` | AuthRead | 撤销指定会话（远程登出设备） |

## 用户端点 (Users)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/users/me` | AuthRead | 当前登录用户完整信息（含 email、隐私设置） |
| PATCH | `/users/me` | Auth | 修改当前用户资料（用户名/Bio/隐私设置），5次/分钟，需邮箱已验证 |
| PATCH | `/users/me/avatar` | Auth | 设置头像（传入 mediaId），需邮箱已验证 |
| DELETE | `/users/me` | Auth | 注销当前账号（软删除，设置 deletedAt），需邮箱已验证 |
| GET | `/users/search?q=xxx` | AuthRead | 搜索用户（@提及用），排除已注销 |
| GET | `/users/:id` | Public | 用户公开资料（不含 email） |
| POST | `/users/follow/:id` | Auth | 关注用户，发送 follow 通知 |
| DELETE | `/users/follow/:id` | Auth | 取消关注 |
| GET | `/users/following` | AuthRead | 我的关注列表 |
| GET | `/users/followers` | AuthRead | 我的粉丝列表 |
| POST | `/users/me/block/:id` | Auth | 拉黑用户 |
| DELETE | `/users/me/block/:id` | Auth | 取消拉黑 |
| GET | `/users/me/blocks` | AuthRead | 我的黑名单 |

## 主题帖端点 (Threads)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads` | Public | 主题帖列表（仅已发布帖），支持分区/排序/标签/Cursor。`filter=all`(默认)公开帖，`filter=playing`我参与的帖（需登录） |
| POST | `/threads` | Auth | 创建主题帖草稿（仅创建 Thread + OWNER 成员，published=false）。发布前需通过 PATCH 完善并设置 published=true |
| GET | `/threads/draft` | AuthRead | 我的草稿箱列表（未发布帖） |
| GET | `/threads/:id` | AuthRead | 详情（含子贴列表）。未发布帖仅 owner 可查看；已发布帖浏览量+1，PRIVATE 帖非成员 404 |
| PATCH | `/threads/:id` | Auth | 修改/发布（仅 OWNER/COLLABORATOR）。设置 published=true 即发布，此时校验 title/category/子贴/楼层完整性，发布后通知粉丝 |
| DELETE | `/threads/:id` | Auth | 删除（仅 OWNER）。未发布帖硬删除（级联），已发布帖软删除 |
| POST | `/threads/:id/invite-link` | Auth | 生成/刷新私密帖邀请链接（需已发布，仅 OWNER） |
| POST | `/threads/join-by-link/:token` | Auth | 通过邀请链接加入私密帖（需已发布） |

## 成员端点 (Thread Members)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/members` | Public | 成员列表 |
| POST | `/threads/:id/members/join` | Auth | 自由加入（需已发布，PRIVATE 帖禁止，返回 403） |
| POST | `/threads/:id/members` | Auth | 邀请用户加入（需已发布，仅 OWNER/COLLABORATOR） |
| PATCH | `/threads/:id/members/:userId` | Auth | 修改成员 role/playerMarked（授予/收回玩家身份，仅 OWNER/COLLABORATOR），需邮箱已验证 |
| DELETE | `/threads/:id/members/me` | AuthRead | 主动退出，取消自己的玩家标记（OWNER 不可退出），需邮箱已验证 |
| DELETE | `/threads/:id/members/:userId` | Auth | 收回该成员的玩家身份（仅 OWNER/COLLABORATOR），需邮箱已验证 |

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
| GET | `/subthreads/:id/posts` | Public | 楼层列表（Cursor 分页），只返回 parentPostId=null 的楼层 |
| POST | `/subthreads/:id/posts` | Auth | 发帖（楼层/楼中楼），需邮箱已验证，事务分配 floorNumber |
| GET | `/posts/:id` | Public | 帖子详情，含 likeCount |
| GET | `/posts/:id/replies` | Public | 楼中楼回复列表（Cursor 分页） |
| PATCH | `/posts/:id` | Auth | 编辑（仅作者自己），需邮箱已验证，乐观锁 |
| DELETE | `/posts/:id` | Auth | 软删除（仅作者，第一楼除外），需邮箱已验证 |
| POST | `/posts/:id/like` | Auth | 点赞（upsert），需邮箱已验证 |
| DELETE | `/posts/:id/like` | Auth | 取消点赞，需邮箱已验证 |

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
| GET | `/notifications` | AuthRead | 通知列表，含关联 post/thread/fromUser |
| GET | `/notifications/unread` | AuthRead | 未读通知数 |
| PATCH | `/notifications/:id/read` | AuthRead | 标记单条已读 |
| POST | `/notifications/read-all` | AuthRead | 全部已读 |

## 订阅端点 (Subscriptions)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/subscriptions` | AuthRead | 我的订阅列表 |
| POST | `/subscriptions` | AuthRead | 创建订阅 (type=THREAD/USER, USER 需 targetUserId) |
| DELETE | `/subscriptions/:id` | AuthRead | 取消订阅 |

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
| GET | `/reading-progress/new-replies` | AuthRead | 某子贴新增回复数 |
| POST | `/reading-progress` | AuthRead | 记录/更新阅读进度 |
| POST | `/reports` | Auth | 提交举报（已搁置），需邮箱已验证 |
| GET | `/reports` | AuthRead | 举报列表（管理员，已搁置） |
| PATCH | `/reports/:id/handle` | Auth | 处理举报（管理员，已搁置），需邮箱已验证 |
| GET | `/admin` | Public | 管理后台入口 |
| GET | `/health` | 无 | 健康检查 |
