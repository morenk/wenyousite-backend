# API 端点表

> 全局前缀 `/api/v1`（开发环境）。无特殊说明时 `Guard` 为控制器级别默认值。

## 认证端点 (Auth)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| POST | `/auth/register/request-code` | 无 | 注册第一步：请求邮箱验证码（限流 1/min） |
| POST | `/auth/register/verify-and-complete` | 无 | 注册第二步：验证码+用户名+密码，完成注册 |
| POST | `/auth/login` | 无 | 邮箱+密码登录，返回双 Token + 用户信息 |
| POST | `/auth/refresh` | 无 | 用 refreshToken 换取新双 Token |
| POST | `/auth/verify-email` | 无 | 邮箱验证码校验（限流 5/min） |
| POST | `/auth/resend-verification` | 无 | 重发验证邮件（限流 1/min） |
| POST | `/auth/change-password` | AuthRead | 修改密码（需旧密码），修改后所有旧 Token 失效 |
| POST | `/auth/forgot-password` | 无 | 发送找回密码邮件（限流 1/min） |
| POST | `/auth/reset-password` | 无 | 用验证码重置密码，成功后所有旧 Token 失效（限流 5/min） |
| POST | `/auth/logout` | AuthRead | 登出，使所有已签发 Token 立即失效 |

## 用户端点 (Users)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/users/me` | AuthRead | 当前登录用户完整信息（含 email、隐私设置） |
| PATCH | `/users/me` | AuthRead | 修改当前用户资料 |
| DELETE | `/users/me` | AuthRead | 注销当前账号（软删除，设置 deletedAt） |
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
| GET | `/threads` | Public | 主题帖列表，支持分区筛选/排序/标签/Cursor 分页。只显示 PUBLIC 帖 |
| POST | `/threads` | AuthRead | 创建主题帖（事务：Thread+Subthread+Post+Member）。通知粉丝 |
| GET | `/threads/:id` | AuthRead | 详情（含子贴列表），浏览量+1。PRIVATE 帖非成员 404 |
| PATCH | `/threads/:id` | AuthRead | 修改（仅 OWNER/COLLABORATOR），乐观锁 |
| DELETE | `/threads/:id` | AuthRead | 软删除（仅 OWNER） |
| POST | `/threads/:id/invite-link` | AuthRead | 生成/刷新私密帖邀请链接（仅 OWNER） |
| POST | `/threads/join-by-link/:token` | AuthRead | 通过邀请链接加入私密帖 |

## 成员端点 (Thread Members)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/members` | Public | 成员列表 |
| POST | `/threads/:id/members/join` | AuthRead | 自由加入（PRIVATE 帖禁止，返回 403） |
| POST | `/threads/:id/members` | AuthRead | 邀请用户加入（仅 OWNER/COLLABORATOR） |
| PATCH | `/threads/:id/members/:userId` | AuthRead | 修改成员角色/玩家标记（仅 OWNER/COLLABORATOR） |
| DELETE | `/threads/:id/members/:userId` | AuthRead | 踢出成员。PRIVATE 帖仅取消 playerMarked |

## 子贴端点 (Subthreads)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/threads/:id/subthreads` | Public | 子贴列表（过滤已软删除） |
| POST | `/threads/:id/subthreads` | AuthRead | 创建子贴（仅 OWNER/COLLABORATOR），事务创建+首楼 |
| GET | `/subthreads/:id` | Public | 子贴详情 |
| PATCH | `/subthreads/:id` | AuthRead | 修改子贴（仅 OWNER/COLLABORATOR），乐观锁 |
| DELETE | `/subthreads/:id` | AuthRead | 软删除（仅 OWNER/COLLABORATOR） |

## 楼层端点 (Posts)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/subthreads/:id/posts` | Public | 楼层列表（Cursor 分页），只返回 parentPostId=null 的楼层 |
| POST | `/subthreads/:id/posts` | AuthRead | 发帖（楼层/楼中楼），事务分配 floorNumber |
| GET | `/posts/:id` | Public | 帖子详情，含 likeCount |
| GET | `/posts/:id/replies` | Public | 楼中楼回复列表（Cursor 分页） |
| PATCH | `/posts/:id` | AuthRead | 编辑（仅作者自己），乐观锁 |
| DELETE | `/posts/:id` | AuthRead | 软删除（仅作者，第一楼除外） |
| POST | `/posts/:id/like` | AuthRead | 点赞（upsert） |
| DELETE | `/posts/:id/like` | AuthRead | 取消点赞 |

## 草稿端点 (Drafts)

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/drafts` | AuthRead | 当前用户草稿列表 |
| GET | `/drafts/:id` | AuthRead | 获取单条草稿 |
| POST | `/drafts` | AuthRead | 保存草稿（不传 slot 自动选 1-5 空闲位，满时 400） |
| PATCH | `/drafts/:id` | AuthRead | 更新草稿内容 |
| DELETE | `/drafts/:id` | AuthRead | 删除草稿 |
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
| POST | `/media/upload-url` | AuthRead | 获取预签名上传 URL（有效期 10 分钟） |
| POST | `/media/upload-done` | AuthRead | 确认上传完成，写入 DB，入队图片处理 |

## 其他端点

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/search?q=xxx` | Public | 全文搜索（POST 正文 + Thread 标题，ILIKE） |
| GET | `/tags` | Public | 搜索标签 |
| POST | `/tags` | AuthRead | 创建标签 |
| GET | `/reading-progress` | AuthRead | 所有子贴阅读进度 |
| GET | `/reading-progress/new-replies` | AuthRead | 某子贴新增回复数 |
| POST | `/reading-progress` | AuthRead | 记录/更新阅读进度 |
| POST | `/reports` | AuthRead | 提交举报（已搁置） |
| GET | `/reports` | AuthRead | 举报列表（管理员，已搁置） |
| PATCH | `/reports/:id/handle` | AuthRead | 处理举报（管理员，已搁置） |
| GET | `/admin` | Public | 管理后台入口 |
| GET | `/health` | 无 | 健康检查 |
