# 动态区

动态是独立于主题帖的公开短内容。标题、正文和评论均为字符串，不进入通用 Markdown 管线；客户端只可按 [`internal-reference v1`](./internal-references.md) 额外识别命名或裸站内传送门，其他 Markdown 与外链仍按字面文本显示。动态最多绑定 9 张已完成处理且属于作者的图片。无图动态由客户端根据服务端返回的 `textCoverTheme` 绘制“温油便笺”封面。

动态卡片的 `contentExcerpt` 在截断前把显式传送门降级为用户名称、裸站内坐标降级为“传送门”。后端不会为摘要查询目标元数据，目标不存在、被删除或当前不可见都不改变响应形状。

发现/关注流、动态搜索、当前用户收藏、公开用户收藏和用户主页动态统一复用 `MomentCardResponseDto` 投影。搜索只额外附加可选相关度；本人的动态收藏额外附加私有 `bookmarkFolderId`，公开动态收藏不包含收藏记录或收藏夹字段。各入口自己的排序和游标保持独立，登录查看时 `viewerLiked` / `viewerBookmarked` 都按当前查看者计算。

动态收藏与主题帖共用私有收藏夹。`POST /moments/:id/bookmark` 的请求体和 `folderId` 均可省略以兼容旧客户端；首次收藏进入默认收藏夹。本人可通过 `GET /moments/bookmarks?folderId=` 筛选并用 `PATCH /moments/:id/bookmark` 移动。`GET /users/:id/moment-bookmarks` 服从 `showBookmarks`，并继续应用软删除和双向拉黑过滤。

`GET /moments` 提供发现和关注两种游标流。发现流首屏综合新鲜度、点赞、评论、收藏和累计加油，按当时顺序把最多 1000 个候选固化为 Redis 快照；后续游标只读取该快照偏移，因此实时互动变化不会造成跨页重复或跳项，首屏之后发布的内容也不会插入当前会话。快照空闲 15 分钟过期，过期游标返回 400，客户端刷新即可获得新快照。关注流严格按创建时间倒序。登录查看时，两种流、详情、评论和搜索均排除双向拉黑关系；排名后装载卡片还会再次校验可见性，覆盖翻页期间新增拉黑的竞态。

楼中楼只有两层视觉结构。回复可指向同一主评论下的任意评论，服务端将 `parentCommentId` 统一固定到主评论，并通过 `replyToComment` 保留实际回复目标。主评论默认最新优先，回复默认时间正序；两类列表都可通过 `order=OLDEST|NEWEST` 切换，并可用 `authorId` 只看某位实际回复者。筛选楼中楼时仍返回所属主评论作为上下文，但内嵌回复与计数只覆盖目标作者。`GET /moments/:id/comment-authors` 返回当前查看者可见的实际评论作者候选，并排除双向拉黑用户。

`GET /moments/:id/comments/:commentId/context` 接受主评论或楼中楼 ID，返回可直接注入页面的 `root`、精确 `target` 与当前查看者可见的 `replyCount`，供通知等稳定 ID 入口定位首屏之外的评论。客户端不得为定位遍历评论或回复分页；目标是楼中楼时展开 `root` 并定位 `target`。目标不存在、已删除或因双向拉黑不可见时返回 404；若主评论已删除但目标楼中楼仍可见，则返回不含正文的墓碑主评论以保留层级。移动端状态转换由 [`mobile-v1-golden-fixtures.json`](../../contracts/mobile-v1-golden-fixtures.json) 的 `momentCommentNavigation` 固定。

动态加油沿用钱包的金额、分成、事务重试和幂等规则。动态页只公开累计总额，不公开加油者名单；评论、回复与加油通过可靠事件链路通知目标用户。
