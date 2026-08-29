# API 合同变更

## 5.14.1-dev.20260829.1

- `/meta.markdownContractVersion` 从 `3` 激活为 `4`。已审查的 Windows 移动端提交 `6a14e84a3cd58ed7705e645a4e590e52ab57f2e2` 同时接受 v3/v4，并已实现 Markdown v4 块对齐、编辑能力门控与 clipboard v2；Web 在读取到 v4 后开放正文对齐入口。
- Markdown v4 语法、正文存储字段、数据库结构和既有 API 形状均不变；本切片只结束旧移动端兼容窗口并发布已经向前兼容部署的能力声明。

## 5.14.0-dev.20260829.1

- 正文契约升级为 Markdown v4：普通段落与 H2/H3 可通过紧邻前置的 `[wenyousite-align-v1-center|right]: #` 隐藏引用定义保存对齐；左对齐不写标记。列表、引用、普通图片、分隔线、协议空段、孤立或未知版本标记仍被拒绝，提及、骰子和收藏表情继承合法父段落。
- 编辑器往返黄金契约升级为 v6，剪贴板契约升级为 v2：本站结构片段保留合法块对齐，`text/plain` 与外部粘贴不携带或推断对齐；v2 读取器继续接受不含对齐的 v1 envelope。Foundation 正式依赖版本为 `v6.7.0`。
- 后端先向前兼容接受 v4 正文，激活前 `/meta.markdownContractVersion` 继续返回 `3`，因此旧移动端不会被锁出且 Web 不开放对齐写入。该兼容窗口已由 `5.14.1-dev.20260829.1` 结束。
- 新增可选鉴权端点 `GET /threads/:threadId/posts/latest`（`postsFindLatestInThread`），一次返回主题全部存活子贴内按 `createdAt DESC, id DESC` 定位的最新有效主楼层或楼中楼回复；编辑旧内容不会改变定位结果。
- 响应 `LatestThreadPostResponseDto` 只包含 `id / threadId / subthreadId / parentPostId / createdAt`，客户端可直接复用主楼层与楼中楼稳定链接，不需要遍历子贴或分页。正文 `BODY`、已删除帖子、已删除子贴和父楼已删除的回复均不参与定位。
- 接口复用主题可见性与 404 防泄漏语义；主题内暂无楼层或回复时返回 `POST_NOT_FOUND`。这是向后兼容新增，旧 Web 与移动端无需迁移；Windows 移动端接入留给独立契约同步切片。

## 5.13.2-dev.20260828.1

- 编辑器往返黄金契约升级为 v5：新增 `* / _ / ~~` 行内定界符在标点或符号边界紧邻正文时的语义恢复与安全规范输出，覆盖粗体、斜体、粗斜体、删除线及下划线别名；转义、代码、空白边界与普通单词内下划线仍保持字面文本。正文 Markdown 版本继续为 v3，HTTP API、OpenAPI、字段和数据库均不变。
- 新增 `editor-clipboard-v1-fixtures.json`，固定 Web 与 Flutter 的阅读选区、整篇菜单和编辑器复制入口，以及本站片段、外部文本/HTML、拖放、传送门网址例外和失效标记回退。阅读端传送门、提及和骰子保留语义，图片与表情标签化；编辑器内部媒体继续保留。正文 Markdown 版本和 HTTP API 均不变，Flutter 实现留给 Windows 独立切片。

## 5.13.1-dev.20260827.1

- `GET /moments` 的发现流与关注流统一改为纯顶帖顺序：按最后一条未删除评论时间倒序，无评论时按动态发布时间倒序；点赞、收藏、加油和编辑不再影响排序，删除最新评论后按剩余评论自动回落。
- 两种主 Feed 共用“顶帖时间 + 动态 ID”的不透明游标。升级前的发现快照游标和关注流发布时间游标会返回 HTTP 400 / `40007 INVALID_CURSOR`，客户端应从首页重载；响应字段、路径、鉴权和分页 envelope 不变。
- 发现流不再依赖 Redis 排名快照，也不再因快照读写失败返回专属 HTTP 503。搜索、用户主页动态与动态收藏继续保持各自原排序。

## 5.13.0-dev.20260826.1

- 主题帖夹与动态夹拆为两套独立目录：新增 `moment_bookmark_folders`，动态收藏外键只能引用动态夹；同一账号可在两套目录中分别创建同名条目，各自拥有默认夹、唯一约束、计数和筛选范围。
- 新增 `GET /moments/bookmark-folders`（`momentsBookmarkFolders`）与 `POST /moments/bookmark-folders`（`momentsCreateBookmarkFolder`）。原 `GET/POST /bookmarks/folders` 明确只管理主题帖夹；原响应中的 `momentBookmarkCount` 标记为旧客户端兼容字段，新客户端不得据此合并目录。
- 迁移把既有目录等 ID 复制到动态夹表，旧无请求体动态收藏继续进入动态默认夹；旧客户端传原主题帖夹 ID 时只映射到独立的同名动态夹，不会让动态收藏引用主题帖夹。公开收藏响应、`showBookmarks`、收藏计数与内容可见性不变。

## 5.12.3-dev.20260826.1

- 他人在主题内发表新主楼层时，主题楼主现在收到 `type/action=reply` 的直接互动通知，`replyTargetUserId/replyTargetName` 指向楼主；客户端因此显示“发送者 回复了你”并归入“互动”。
- 同一主楼层对非作者协作者和实际订阅者仍使用 `type/action=new_post` 与“发布了新楼层”，继续归入“订阅”；子贴正文和 5.12.2 的楼中楼原因分流保持不变。显式提及仍优先，拉黑与 PRIVATE 成员过滤、导航目标和接收范围均不扩大；历史通知不回填。

## 5.12.2-dev.20260826.1

- `POST /subthreads/:subthreadId/posts` 收紧楼中楼父级不变量：携带 `replyToPostId` 时必须同时携带 `parentPostId`，且回复目标必须是该主楼层本身或其直属楼中楼回复；非法组合返回 HTTP 400，现有合法请求不变。
- 楼中楼通知按 `mention → reply → new_post` 原因去重。直接被回复者继续收到 `reply/action=reply`；楼主、协作者、THREAD 订阅者及对应 USER 订阅者改收 `new_post/action=new_reply`，兼容正文为“发布了楼中楼回复”。每个用户对同一次发言最多收到一条通知。
- 新帖 Outbox 重试复用已持久化的完整提及快照与稳定通知键；首次提及投递失败后不会丢失，也不会降级成重复的回复或订阅通知。历史通知不补发。

## 5.12.1-dev.20260826.1

- `DELETE /threads/:id`、`POST /threads/:id/like` 与 `DELETE /threads/:id/like` 现在都先经过统一主题访问校验，再读取所有权、发布状态或互动数据。不存在、已删除、他人草稿及 PRIVATE 非成员统一返回 HTTP 404 / `THREAD_NOT_FOUND`，不会通过 403 或“草稿暂不支持点赞”泄露主题存在性。
- 已获访问权但非楼主的删除请求继续返回 403；楼主对本人草稿点赞或取消点赞继续返回 400。响应字段、邀请加入、提及过滤、通知范围和媒体对象访问策略均未改变。

## 5.12.0-dev.20260826.1

- `NotificationPayloadResponseDto` 向后兼容新增可选、可空 `replyTargetUserId` 与 `replyTargetName`。新建 `reply` 通知固定写入实际被回复帖作者的 ID 和用户名；`schemaVersion=1`、`type/action=reply`、导航目标与通知分类保持不变。
- 回复目标优先取 `replyToPostId`，省略时取 `parentPostId`；兼容正文改为“发送者 回复了目标用户：预览”。历史通知不回填，新客户端遇到缺少回复目标的旧 payload 必须使用不指向当前用户的中性文案。

## 5.11.3-dev.20260825.1

- 编辑器往返黄金契约升级为 v4：分隔线规范为 `正文\n\n---\n\n正文`，并新增实际块语义断言；历史 `正文\n---` 继续按 Setext H2 解析，编辑保存后规范为 `## 正文`。正文 Markdown 版本、HTTP API 与字段均不变。

## 5.11.2-dev.20260825.1

- 编辑器往返黄金契约升级为 v3，新增“粗体后普通软换行”的跨端用例；正文存储继续使用 Markdown v3，API、字段与显式硬换行拒绝规则均不变。

## 5.11.1-dev.20260825.1

- 动态主评论列表的 `order` 只控制主评论；每条主评论内嵌的最早三条楼中楼固定按 `createdAt ASC, id ASC` 返回，不再随主评论倒序。
- 独立楼中楼列表继续默认 `OLDEST` 并保留显式 `NEWEST` 的兼容能力；响应字段、游标格式和 API v1 路径不变。

## 5.11.0-dev.20260825.1

- `NotificationTargetResponseDto` 向后兼容新增必填 `state=ACTIVE|CONTENT_DELETED|USER_DEACTIVATED|NO_TARGET`。删除或注销目标保留为历史通知，但返回 `kind=none`、清空导航 ID、强制视为已读且不能标回未读；目标恢复后历史通知仍保持已读。
- 通知列表按当前主题成员资格隔离 PRIVATE 内容；未获邀请的用户既看不到对应历史记录，也不会计入未读。所有帖子、提及、点赞和订阅通知在最终落库/推送前再次验证目标存活与收件人权限；私密主题发布不再向楼主的关注者发送 `thread_created`。
- 管理员隐藏主题、帖子、动态或动态评论时，同一事务把相关通知标为已读。被隐藏主楼层下的存活回复不再可通过详情、搜索或回复入口访问；管理员隐藏动态主评论时其回复子树同样不可访问，作者自行删除主评论的既有墓碑语义保持不变。
- 普通主题详情、楼层和互动入口继续对未获邀请的 PRIVATE 用户返回与不存在一致的 404；只有持有有效邀请 token 的预览端点返回加入所需的最小概要，正式加入后才开放完整内容。

## 5.10.0-dev.20260823.1

- `POST /media/upload-url` 向后兼容新增可选 `purpose`（`AVATAR / PROFILE_COVER / DIRECT_MESSAGE / MOMENT / MOMENT_COMMENT / RICH_CONTENT / STICKER_SOURCE / LEGACY`）。旧客户端省略时使用 `LEGACY`，继续生成原有三种派生图；业务绑定接口接受同用途或历史 `LEGACY` 媒体。
- 新上传先写随机临时对象，图片 Worker 校验真实格式后将静态图旋转归正、最长边限制为 2560px、清除元数据并写为 WebP 标准化主图；正式 URL 不再保存静态原件。GIF 在帧数、时长、尺寸与累计像素限制内保留动画原件。处理成功或终态失败后立即删除临时对象，定时任务补偿清理。
- `MediaResponseDto` 向后兼容新增必填 `purpose` 与 `animated`；私聊和动态媒体响应新增必填 `animated`，动态媒体同时补齐既有可空 `contentType`。派生图按用途最小化生成，客户端只使用响应给出的非空 URL，不再猜测对象键。

## 5.9.0-dev.20260823.1

- 新增 `GET /users/me/collaborated-threads`（`usersGetMyCollaboratedThreads`）：只返回当前用户角色为 `COLLABORATOR` 的已发布、未删除主题，PUBLIC 与 PRIVATE 均可读；按 `updatedAt DESC, id DESC` 使用不透明复合游标分页，非法游标返回 `40007`。
- `ThreadDetailResponseDto.subthreads[]` 向后兼容新增必填 `postingCapability: { canPost, denialReason }`。拒绝原因固定为 `AUTHENTICATION_REQUIRED / BLOCKED_RELATION / COLLABORATOR_REQUIRED / PLAYER_REQUIRED`；允许发言时 `denialReason=null`。详情展示与楼层/回复写入共用同一策略。
- 双向拉黑不隐藏仍有权限读取的主题或协作列表，但优先禁止发言；原写接口继续使用既有 401、`NOT_COLLABORATOR(40302)`、`NOT_PLAYER(40303)` 与拉黑 403 语义。
- `PARTICIPANT ↔ COLLABORATOR` 的真实角色转换新增可靠 Outbox 事件，并向目标用户发送幂等 `system` 通知。payload 携带 `action/threadId/threadTitle/actorId/actorName/oldRole/newRole`；同角色重放和仅修改玩家标记不产生任免通知。

## 5.8.1-dev.20260823.1

- 动态卡片与详情向后兼容新增可选 `canInteract`；已注销作者的历史动态在详情、显式搜索和旧收藏中保留墓碑阅读，但禁止新增点赞、评论、收藏、移动收藏和加油。既有点赞/收藏可取消，评论可按正常权限删除或治理。
- 发现与关注流隐藏已注销作者；`GET /users/:id/moments` 对已注销用户继续返回 404。动态、评论不存在统一为 `40415`，无效游标为 `40007`，幂等键载荷冲突为 `40912`，编辑版本冲突为 HTTP 409 / `40002`。
- 动态和动态评论的媒体参数改为 CUID 校验；非搜索列表最多每页 50 条，搜索仍为 20 条。`GET /moments` 每 IP 每分钟 10 次，`POST /moments` 每 IP 每分钟 5 次。
- 发现流快照的 ZSET 与 TTL 改为 Redis 原子事务写入；快照读写失败返回 HTTP 503 / `50000`，过期或无效快照游标仍返回 HTTP 400 / `40007`。

## 5.8.0-dev.20260823.1

- 所有主题帖列表、草稿、详情、邀请预览与订阅响应向后兼容新增必填可空 `categoryInfo: { slug, name, isActive } | null`；原 `category: string | null` 保留。已停用分类仍返回注册表当前名称，未知历史 slug 返回同名且 `isActive=false` 的安全读模型。
- 分类 slug 统一为去除首尾空白并转大写后的 `^[A-Z][A-Z0-9_]{0,49}$`，发现与管理列表按 `sortOrder ASC, slug ASC` 稳定排序；公开 `/thread-categories` 继续只返回启用分类。
- 分类定为纯文本能力：`icon`、`mergedIntoId` 仅为数据库和旧线协议兼容字段并在 OpenAPI 标记废弃，新 `categoryInfo` 不包含二者。分类黄金契约升级为 `thread-category-v3-fixtures.json`。
- 管理员分布统计的 `threadsByCategory` 新增当前 `name` 与 `isActive`，分类写入后失效线程列表和详情读缓存。

## 5.7.0-dev.20260823.1

- 草稿创建向后兼容新增可选 UUID v4 `clientRequestId`；同一用户以相同键重放相同规范化正文与槽位时返回原草稿，复用到不同载荷返回 `40912 IDEMPOTENCY_KEY_REUSED`。
- 新增 `GET /drafts/state`，从同一数据库快照返回 `drafts / usedSlots / maxSlots / slots`；原 `/drafts` 与 `/drafts/slots` 保持可用。
- `DELETE /drafts/:id` 向后兼容新增可选 `version` 查询参数：版本落后返回 `40002 OPTIMISTIC_LOCK_CONFLICT`，相同删除重放幂等成功。GET/PATCH 不存在或越权草稿统一返回 `40405 DRAFT_NOT_FOUND`。
- 携带旧 `version` 的 POST 在目标槽位已删除时不再降级为新建，避免离线设备复活草稿。旧的 POST 槽位覆盖暂留兼容；客户端应改用 `PATCH /drafts/:id`，待移动端迁移后再移除。

## 5.6.0-dev.20260823.1

- 新增 `GET /subthreads/:subthreadId/posts/authors`，只返回当前子贴中实际发布过未删除主楼层的楼主、协作者与已标记玩家，供主楼层“只看某人”提前筛选候选。
- 新增 `GET /posts/:id/replies/authors`，只返回指定主楼层下实际发布过未删除楼中楼回复的同类角色作者；不会把主题帖其他楼层的成员混入候选。
- 两个候选接口沿用对应列表的可见性检查与 404 语义，响应按楼主、协作者、玩家及用户名稳定排序。现有列表参数和旧客户端行为不变。

## 5.5.0-dev.20260822.1

- `GET /subthreads/:subthreadId/posts` 向后兼容新增可选 `authorId`，只筛选由当前主题楼主、协作者或已标记玩家创建的主楼层；普通参与者不属于可选角色范围并返回空页。
- `authorId` 与 `order`、cursor 属于同一主楼层查询范围；切换筛选后客户端必须从第一页重新读取。省略参数时原有排序、游标与响应行为不变。
- 作者筛选不传入每层内嵌的最早 5 条楼中楼预览，因此目标主楼仍展示不同作者的既有回复。参数接受当前 CUID 用户 ID，并兼容 UUID 形态。

## 5.4.0-dev.20260821.1

- 新增 `POST /media/:id/upload-url`：仅为本人仍处于 `UPLOADING` 的媒体重新签发 PUT 地址，保持原 `mediaId`、对象 key 和公开 URL，不重复创建记录或计入小时上传配额。
- `POST /media/upload-done` 在对象尚不存在时返回 HTTP 404 / `MEDIA_OBJECT_MISSING`，客户端可据此重签并重传同一媒体；确认的幂等和处理状态响应保持不变。
- 媒体引用新增头像、帖子正文和草稿正文的结构化关系，并以 `Media.orphanedAt` 维护已完成媒体的引用宽限期；现有 URL 响应与私聊、PRIVATE 内容访问语义不变。

## 5.3.0-dev.20260820.1

- 站内传送门 v1 接受 `wenyou.site`、`www.wenyou.site` 与相对坐标并统一规范化为相对地址；命名标签支持反斜线和方括号转义，裸地址要求完整边界。
- 同一主题坐标同时含 `post` 与 `subthread` 时固定以 `post` 为准并清理多余参数；分享地址只携带内容坐标，不携带排序等界面状态。
- 私聊 `contentPreview` 字段形状不变，语义调整为去除传送门语法、规范化空白并隐藏邀请 token 后的 120 字符纯文本；完整消息正文保持原字符串。Outbox 与 FCM 仍只携带必要 ID。
- 站内传送门 fixture 新增 `www`、转义标签、裸地址边界、精确坐标优先级和私聊预览脱敏用例；旧字符串正文无需迁移。

## 5.2.0-dev.20260818.1

- 动态收藏接入私有收藏夹：`POST /moments/:id/bookmark` 可选传 `folderId`，新增 `PATCH /moments/:id/bookmark` 移动收藏，`GET /moments/bookmarks` 可按 `folderId` 筛选并仅在本人响应附带 `bookmarkFolderId`。
- 收藏夹响应向后兼容新增 `momentBookmarkCount`；原 `bookmarkCount` 继续表示主题帖收藏数量。旧客户端不传动态收藏请求体时仍进入默认收藏夹，重复旧请求不会覆盖已有分类。
- 新增 `GET /users/:id/moment-bookmarks` 公开动态收藏分页，复用 `showBookmarks`、动态软删除和双向拉黑可见性；公开响应不暴露收藏记录或收藏夹信息。

## 5.1.0-dev.20260817.1

- `GET /bookmarks`、`GET /users/:id/bookmarks`、`GET /users/:id/created-threads` 与 `GET /users/:id/played-threads` 向后兼容补齐首页主题帖卡片字段：默认子贴、正文摘要、首张普通图片封面、主题标签及玩家计数。
- 首页、主题帖搜索、收藏和用户主页列表改为复用同一主题帖查询投影与白名单 mapper；搜索继续额外返回可选 `relevance`，本人收藏继续额外返回 `bookmarkId` / `bookmarkFolderId`。
- 动态发现、搜索、收藏和用户主页列表确认继续复用同一 `MomentCardResponseDto`；路由、权限、筛选、排序和各自的不透明游标语义均未改变。

## 5.0.0-dev.20260816.1

- 破坏性删除主题帖分类的 `color` 字段：数据库列、公开与管理响应、创建/更新请求以及分类黄金夹具均不再包含该字段。
- 分类黄金契约升级为 `thread-category-v2-fixtures.json`；客户端必须改为 Foundation 统一中性呈现。
- 数据库迁移同时清理分类审计元数据中的历史颜色值；旧客户端继续发送 `color` 时会因未知字段返回 400。

## 4.14.0-dev.20260816.1

- `GET /subthreads/:subthreadId/posts` 向后兼容新增可选 `order=OLDEST|NEWEST`，默认 `OLDEST`，支持主楼层按 `floorNumber` 正序或倒序的稳定游标分页。
- 主楼层顺序不影响每层内嵌的最早 5 条楼中楼回复；旧客户端省略新参数时行为不变。

## 4.14.0-dev.20260815.1

- 用户身份统一为“游客 / 已注册用户”：注册验证码验证成功后才创建 `User`，移除 `User.emailVerified`、未验证账号守卫和邮箱验证/重发端点。
- 管理通知受众不再按邮箱验证状态筛选；个人资料、写操作和私聊只区分是否登录，移动端与 Web 需同步移除冗余邮箱状态消费。
- 现有数据库中的未完成旧账号会在迁移中吊销会话并软注销；相关计划通知取消，验证码记录清理后删除旧字段。契约保持 v4.x，版本升级为 `4.14.0-dev.20260815.1`。

## 4.13.1-dev.20260815.1

- 站内传送门 v1 新增 `editorPasteCases` 机器旅程，固定单独粘贴主题或私密邀请地址时的规范化、选区名称、默认名称，以及非法邀请、混合文本和站外链接的普通粘贴降级。
- 移动 V1 黄金旅程新增 `momentCommentNavigation`，固定主评论、楼中楼、墓碑主评论、404 与临时失败的定位状态；`momentsCommentContext` 单独提升为移动 V1 planned 能力。
- 移动接入指南明确邀请 token 的凭据边界和动态通知定位流程；手写文档不再复制易漂移的 operationId 总数。HTTP 字段、状态码和旧客户端行为不变。

## 4.13.0-dev.20260815.1

- 新增 `GET /moments/:id/comments/:commentId/context`，按主评论或楼中楼 ID 返回可直接定位的 `root`、`target` 与当前可见 `replyCount`，客户端无需遍历评论分页。
- 接口沿用动态、软删除与双向拉黑可见性；目标不存在、已删除或不可见时返回 404，主评论已删除但目标楼中楼仍可见时保留墓碑主评论。
- 现有动态评论分页、通知字段与旧客户端行为保持不变；Web 可继续兼容 `comment` / `reply` 深链接参数。

## 4.12.0-dev.20260814.1

- 正文协议升级为 Markdown v3：只有 Foundation 主栏与“更多”中的能力可成为结构化正文；表格、任务列表、代码块、额外标题、显式硬换行、原始 HTML、未知协议节点和超过三层列表不再属于产品能力。
- 所有帖子、主题聚合、子贴正文与云草稿写入口在任何骰子、图片、提及和持久化副作用前统一校验；直接 API 提交不支持结构返回 HTTP 400、`UNSUPPORTED_MARKDOWN_FORMAT = 40009`，消息指出首个类型。
- 新增三份 Markdown v3 跨端黄金语料和默认 dry-run 的幂等迁移命令；客户端对不支持结构静默保留为字面文本，历史阅读数据采用同一防御降级。
- 站内传送门 v1 增补 16 位私密邀请坐标 `/join/{token}`；同源绝对邀请地址规范化为相对地址，查询参数、片段和非法 token 继续拒绝。HTTP 接口与数据库字段不变。

## 4.11.0-dev.20260814.1

- `GET /search/threads` 改为与动态搜索一致的游标分页响应，在原有主题帖字段之外向后兼容补齐首页主题帖卡片的状态、正文摘要、标签、默认子贴、互动统计和温油字段；旧客户端继续读取 `data`，新客户端通过 `meta.cursor/hasMore` 加载更多。
- 主题帖搜索继续只匹配公开已发布帖的标题、允许单字符，并保留已注销楼主的公开历史内容；结果改按标题相关度、创建时间和 ID 稳定排序。
- 省略 `limit` 时仍最多返回 50 条以兼容既有移动端；分页客户端应显式传入每页条数。兼容聚合搜索仍返回不带分页元数据的主题帖数组。
- 首页与搜索改用同一白名单卡片 mapper，实际响应只输出 OpenAPI 声明字段，不再夹带幂等请求哈希等未声明的数据库内部列。

## 4.10.0-dev.20260814.1

- 个人主页背景扩展为同源双画幅：保留电脑端 3:1 字段，并新增可空的移动端 2:1 资产；历史背景继续兼容为 `mobile: null`。
- `PATCH /users/me/profile-cover` 新增可选 `mobileMediaId`，新客户端同时绑定两套已完成媒体，旧客户端省略时清空移动裁切；移除背景会同时解除两套引用。
- 移动 V1 黄金旅程新增双画幅选择、Web 回退、原子替换、旧请求和双清理用例；Flutter 业务入口仍保持 planned。

## 4.9.0-dev.20260814.2

- 新增 `POST /moderation/content/:type/:id/hide`，供前台与移动端管理员直接使用普通 Bearer 登录态隐藏内容；服务端实时校验 `ADMIN / SUPER_ADMIN` 角色，不要求独立站务 Cookie、CSRF 或邮件 step-up。
- `/admin/**` 站务台认证边界保持不变；新入口与站务台隐藏、案件处置继续复用同一内容状态、审计与缓存失效事务。

## 4.9.0-dev.20260814.1

- 新增 `GET /admin/content/hidden`，按当前数据库状态分页返回仍由站务隐藏的主题帖、帖子、动态与动态评论，并提供作者、处置人、理由及父级可见性导致的恢复阻塞信息。
- 管理端隐藏/恢复写接口保持不变；新列表只使用独立站务 Cookie 会话，普通用户与移动端契约不受影响。

## 4.8.0-dev.20260813.2

- 新增 `GET /users/:id/activity-summary`，按当前查看者的可见范围返回动态、创建主题、玩家身份参与主题和楼层回复总数。
- `playedThreadCount` 与 `replyCount` 在对应资料隐私关闭且查看者非本人时返回 `null`；动态统计继续遵守双向拉黑过滤，主题统计继续遵守公开/私密可见性。

## 4.8.0-dev.20260813.1

- 当前用户与公开用户资料向后兼容新增可空的 `profileCover`，包含原图、中图和原始尺寸；已注销用户仍只返回最小墓碑资料。
- 新增 `PATCH /users/me/profile-cover` 与 `DELETE /users/me/profile-cover`，复用现有媒体上传链路，以本人已完成的 3:1 jpg/png/webp 媒体设置或移除个人主页背景图。

## 4.7.0-dev.20260811.1

- 新增 `POST /moderation/appeal-token`：账号密码校验成功后签发 15 分钟、仅限申诉接口使用的 Bearer JWT。普通有效会话与该专用凭据均可读取本人近 30 天决定并提交申诉，被暂停或封禁账号不再因普通 JWT 的处罚前置检查而失去申诉入口。
- `GET /moderation/decisions/mine` 与 `POST /moderation/appeals` 新增 `appeal` 认证模式，并以 OpenAPI 的两个可选 security requirement 明确普通 `bearer` 与 `appealBearer` 是“二选一”，不是同时携带。
- `POST /moderation/appeals` 的成功响应现按声明返回必填 `decision` 与 `appellant`，且只投影公开字段；修正生成客户端收到 201 后仍可能反序列化失败的问题。
- 可选认证端点只在完全未携带 Authorization 时匿名放行；主动携带的过期或无效 Token 返回稳定 `TOKEN_EXPIRED` / `TOKEN_INVALID`。刷新响应补齐既有必填 `user.level`。

## 4.6.0-dev.20260811.1

- 新增 `wenyousite-internal-reference` v1 黄金契约，固定主题帖、子贴、楼层、楼中楼讨论和具体回复的规范地址；同源绝对地址统一规范化为相对地址。
- 动态正文与评论字段仍为字符串且长度边界不变，但客户端可选择性识别 `[名称](站内主题坐标)` 与裸站内主题坐标；其他 Markdown 继续按普通文本显示，旧客户端无需迁移。
- 动态列表的 `contentExcerpt` 将显式传送门降级为其名称、裸传送门降级为“传送门”；服务端不解析目标标题或权限元数据，不新增批量解析接口。

## 4.5.2-dev.20260811.1

- `GET /threads` 首页发现列表不再返回已注销楼主的主题帖；`GET /search/threads`、`GET /search/posts` 与兼容聚合搜索仍可显式找到这些公开历史内容。响应字段形状不变。

## 4.5.1-dev.20260810.1

- 首页主题帖列表和公开主题帖搜索的 `coverImages` 仅返回默认主贴正文中的第一张普通图片；字段继续保持数组形状，无图时返回空数组。

## 4.5.0-dev.20260809.1

- 新增 29 个 operationId：收藏夹分类 3 个；独立管理认证、管理员账号邀请/移交、聚合治理案件、申诉复核、站务开关、通知活动和审计导出共 26 个。移动端覆盖清单把全部 196 个接口唯一分类为 V1 92、deferred 54、管理端不适用 49、基础设施 1。
- 公开用户资料向后兼容新增 `accountStatus=ACTIVE|SUSPENDED|BANNED`；只暴露当前处罚类别，不返回原因或截止时间。
- 主题帖收藏新增私有收藏夹 `id/name/isDefault/bookmarkCount/createdAt`，收藏记录新增 `folderId`，列表支持可选分类筛选与移动；`POST /bookmarks` 的 `folderId` 可选，旧客户端不传时自动归入默认收藏夹。
- 管理端主题分类列表合并公开展示字段与内部状态字段，治理案件响应合并目标、证据、举报计数、决定及处置动作，避免客户端跨接口拼装同一行数据。
- 管理员申诉列表向后兼容新增目标类型与处置动作筛选，继续使用同一不透明游标语义。
- 管理员通知活动列表向后兼容新增关键词、状态与主题帖跳转目标筛选。
- 新增 `ADMIN_SESSION_REQUIRED`、`ADMIN_SESSION_EXPIRED`、`ADMIN_CHALLENGE_INVALID`、`APPEAL_TOKEN_INVALID`、`ADMIN_STEP_UP_REQUIRED`、治理资源不存在/冲突、管理员邀请冲突、`REGISTRATION_PAUSED` 与 `CONTENT_WRITES_PAUSED` 等具名错误码。
- 新增移动端 V1 协议黄金 fixture，固定认证状态机、退出清理、重试矩阵、游标、动态分类、媒体降级、幂等和未知枚举行为；OpenAPI 内容变化必须同时改变版本，禁止同版本不同内容。
- 所有新增查询参数均为可选；用户端举报、决定与申诉契约不变，既有 Web/移动端调用无需迁移。

## 4.4.0-dev.20260809.1

- `/meta` 向后兼容新增 Android/iOS 分平台最低支持构建号、推荐构建号和更新地址；未配置时显式返回 `null`。
- `/auth/logout` 优先按 access token 的稳定终端 ID 撤销整个当前终端，旧客户端继续兼容 Cookie 或请求体 refresh token；无法识别终端时不再静默成功。
- 新增动态主题帖分类 v1 黄金用例，固定重命名、未知历史 slug、空分类和服务端排序的跨端降级行为；HTTP 字段不变。

## 4.3.0-dev.20260808.1

- 动态评论向后兼容新增可选 `mediaId` / `stickerAssetId`；正文、图片、表情至少提供一项，图片与表情互斥且每条最多一个媒体。
- 动态评论响应新增互斥的 `media` / `sticker`，删除评论不再暴露其媒体；普通图片必须属于评论者且处理完成，表情必须来自当前收藏夹。

## 4.2.0-dev.20260808.1

- 帖子楼中楼与动态评论新增 `order=OLDEST|NEWEST` 和可选 `authorId`，排序、筛选与游标分页保持同一查询范围。
- 新增动态评论作者候选接口；帖子作者筛选仅接受当前帖的玩家、楼主或协作者。

## 4.1.0-dev.20260808.1

- 新增动态瀑布流、发布编辑、图片封面、点赞、收藏、两层楼中楼评论、用户动态与动态搜索接口。
- 动态支持沿用钱包规则的“加油”，钱包目标类型新增 `MOMENT`，动态公开累计加油总额。
- 媒体响应新增 480px 信息流衍生图；通知、举报和管理员内容治理新增动态目标。
- 首页主题帖列表和公开主题帖搜索响应新增 `coverImages`，从默认主贴正文按顺序返回最多三张普通图片。

## 4.0.0-dev.20260808.1

- 主题帖分类从固定 Prisma 枚举迁移为管理员可新增、排序和停用的数据库配置，旧 `DEDUCTION / NATION / RPG` 数据原样保留。
- 新增公开分类发现接口 `GET /thread-categories`，发帖与分类筛选改用稳定的动态 `slug`；草稿可暂不选择分类，发布时必须选择启用项。
- 新增管理员分类与标签管理接口；平台标签增加描述、排序和启停状态，停用项不能再被新主题帖选用。
- 分类字段由固定枚举类型改为可空字符串，生成客户端需要重新生成类型。

## 3.3.0-dev.20260808.1

- 新增管理员看板概览、按日时间序列和分布统计接口，统一使用北京时间日期区间。
- 概览同时返回等长上一周期、DAU/WAU/MAU、用户增长、内容产出和治理快照。
- 普通用户的成功产品请求按“用户 + 北京时间日期”去重形成活跃事实；不采集访问路径、IP、管理员和失败请求。

## 3.2.0-dev.20260808.1

- 将搁置的举报原型重构为 `USER / THREAD / POST` 类型化举报、证据快照、游标队列和原子结案。
- 新增管理员用户查询、临时暂停/永久封禁、解除处罚、内容隐藏/恢复、角色管理与不可变审计接口。
- 管理员认证统一支持 `ADMIN / SUPER_ADMIN` 两级；账号处罚立即作用于登录、刷新和现有 Access Token。
- 移除未被客户端消费的旧管理员举报列表/处理端点；`GET /admin` 由公开状态改为受保护能力查询。

## 3.1.0-dev.20260807.1

- 新增 Lv.1～Lv.9 用户等级与本人经验进度字段，用户摘要公开等级。
- 新增温油钱包、北京时间每日签到、用户/主题帖打赏和私密收支流水接口。
- 主题帖公开累计收到的温油总额；用户主页公开累计被打赏总额与次数。
- 新增 `tip`、`level_up` 通知和温油相关业务错误码；主题帖智能排序纳入温油贡献。

## 3.0.0-dev.20260807.2

- 修正 ValidationPipe 参数错误为 `40000 VALIDATION_ERROR`，与已发布错误码契约一致。
- OpenAPI 为所有响应声明请求 ID 和契约版本头，429 额外声明 `Retry-After`。
- 新增 FCM data v1 JSON Schema 与黄金样例，固定通知/私聊的最小导航载荷。
- 澄清移动端 `X-Client-Platform` 必传规则和私聊推送能力，HTTP 路由与业务响应字段不变。

## 3.0.0-dev.20260807.1

- 变更分类：生成接口破坏性、HTTP 线协议向后兼容。
- 固定 lowerCamel operationId、server、鉴权模式和具名成功 envelope。
- 分页 meta 在分页操作中改为必填；清零匿名响应和空查询 schema。
- 新增移动端元数据、设备注册、媒体衍生地址、通知 target，以及创建幂等字段。
- 现有 REST 路由和旧响应字段不删除；后端先部署，Web 随后重新生成类型。

## 2.3.0-dev.20260807

- 向后兼容新增用户表情收藏和 Markdown v2 协议。

## 2.2.0-dev.20260807

- 向后兼容新增主题帖标签精确筛选。

## 2.1.0-dev.20260806

- 向后兼容新增一对一私聊。
