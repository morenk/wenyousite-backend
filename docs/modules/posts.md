# 楼层模块

## 概述

子贴内的楼层发帖、楼中楼回复、编辑、软删除，以及 @提及解析和通知事件触发。

## 涉及的模型

| 模型          | 用途                                                      |
| ------------- | --------------------------------------------------------- |
| `Post`        | 帖子实体（正文 kind=BODY / 楼层 kind=FLOOR / 楼中楼回复） |
| `DiceRoll`    | 由正文内联节点 `nodeId` 关联的服务端正式骰子结果          |
| `PostMention` | @提及记录（归属帖子，由 PostEventsListener 写入）         |

## API 端点

| Method | Path                             | Guard  | 描述                                                                                                                    |
| ------ | -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/subthreads/:subthreadId/posts`         | Public | 楼层列表（Cursor 分页；支持 `order=OLDEST\|NEWEST` 与角色作者 `authorId`；仅筛选主楼层，内嵌每层前 5 条楼中楼保持原样） |
| GET    | `/subthreads/:subthreadId/posts/authors` | Public | 当前子贴中实际发布过未删除主楼层的角色作者候选                                                                        |
| GET    | `/posts/:id/replies`                     | Public | 主楼层的楼中楼回复列表（Cursor 分页；支持 `order=OLDEST\|NEWEST` 与 `authorId`；仅接受 parentPostId=null 的 FLOOR）     |
| GET    | `/posts/:id/replies/authors`             | Public | 当前主楼层下实际发布过未删除楼中楼回复的角色作者候选                                                                  |
| POST   | `/subthreads/:subthreadId/posts` | Auth   | 发帖（创建楼层 kind=FLOOR，含楼中楼回复；正文不通过本接口创建）                                                         |
| PUT    | `/subthreads/:subthreadId/body`  | Auth   | upsert 子贴正文（kind=BODY：无正文创建，有正文乐观锁更新，version 不匹配返回 409；仅 OWNER/COLLABORATOR）               |
| GET    | `/posts/:id`                     | Public | 帖子详情（含导航上下文：帖/子贴/父楼）                                                                                  |
| PATCH  | `/posts/:id`                     | Auth   | 编辑帖子（仅作者，乐观锁 version）                                                                                      |
| DELETE | `/posts/:id`                     | Auth   | 软删除楼层（作者或 OWNER/COLLABORATOR；正文 kind=BODY 不可删）                                                          |

## 响应契约

- 楼层分页接口的 `data` 为 `FloorResponseDto[]`，楼中楼分页接口的 `data` 为 `ReplyResponseDto[]`，游标位于统一 envelope 的 `meta`。
- 创建楼层、upsert 子贴正文和编辑帖子的 `data` 为 `PostResponseDto`。
- 帖子详情的 `data` 为 `PostDetailResponseDto`，包含帖、子贴、父楼和回复计数导航上下文。
- 两个作者候选接口的 `data` 为 `DiscussionAuthorResponseDto[]`，包含公开作者字段、当前主题角色与 `playerMarked`。
- Web/Flutter 必须使用 Swagger 生成类型，不再手写帖子响应结构。
- Post 响应的 `content` 包含内联骰子节点，`diceRolls` 按 `nodeId` 提供服务端正式结果；未发布节点没有对应结果。

## 核心业务规则

- 发帖前校验主题帖访问权限（`ThreadAccessService.assertAccessible`）：私密帖非参与人被拒绝，未发布帖非 owner 被拒绝
- 正文发布校验只过滤空白、空段落和独立分隔线；纯数字正文、裸 HTTP(S) URL 和 CommonMark 自动链接均属于有效内容
- 楼层和楼中楼允许正文只包含内联骰子节点；BODY 发布时必须保留节点之外的可见正文
- 客户端只提交含 `[[dice:v1:<nodeId>:<notation>]]` 节点的正文，正式点数由服务端生成。已发布帖移动节点复用结果，删除节点物理删除结果，同一 nodeId 不得改写表达式；单帖最多 20 个节点
- 创建、正文 upsert 和编辑在骰子、图片、表情、提及及存库前统一执行 Markdown v3 工具栏白名单校验；白名单外格式返回 `40009`，事件和通知摘要使用同一 canonical 正文
- 新版客户端创建楼层/楼中楼时携带 UUID `clientRequestId`；后端按 `authorId + clientRequestId` 唯一，相同请求重试返回首次创建的 Post，不重复占楼层号或发事件
- 同一 `clientRequestId` 若复用于不同子贴、正文（包括内联骰子节点）、parentPostId 或 replyToPostId，返回 HTTP 409，禁止把不同业务请求误判为重试
- 发帖权限校验在自动加入之前：被 PostingPolicy 拒绝时不会写入 ThreadMember 记录
- 楼层编号 floorNumber 在事务内通过 `MAX(floorNumber) + 1` 分配，永不复用；普通楼层（kind=FLOOR）从 #1 开始
- 正文帖（kind=BODY）floorNumber = null，不占楼层号
- 楼中楼回复 floorNumber = null，通过 parentPostId 关联父楼层
- 数据库部分唯一索引保证每个子贴最多一个未删除 BODY；软删除历史 BODY 不阻止恢复创建。创建路径还会锁定父 Thread 并重查，冲突统一映射为 409
- 数据库 CHECK 固化 BODY/主楼层/楼中楼的字段形状，复合外键保证 `threadId` 与子贴所属主题一致，并阻止 parent/replyTo 跨子贴引用；主楼层被硬删除时其楼中楼级联删除，避免留下无楼层号的伪主楼层
- 楼中楼平级挂载：所有回复共享同一个 parentPostId，无嵌套深度限制；回复目标通过 replyToPostId 追踪
- parentPostId 必须属于同一子贴且为主楼层（parentPostId=null），否则拒绝
- replyToPostId 必须属于同一子贴且其所属主楼层仍可见，否则拒绝
- 软删除：设置 deletedAt，列表查询过滤已删除帖子；编辑/删除操作也校验子贴是否已软删。主楼层一旦软删除，其仍存活的楼中楼回复也从单帖详情、正文搜索、通知导航和新回复入口统一视为不存在；创建事务与管理员隐藏共享 Thread 聚合锁并在提交前复核
- 子贴正文（kind=BODY）不可删除，提示"主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴"
- 权限校验通过后自动将用户加入主题帖（upsert ThreadMember，角色 PARTICIPANT）
- 发帖权限由子贴的 postingPolicy 控制；OWNER/COLLABORATOR 可绕过所有子贴策略：
  - PARTICIPANTS：所有已通过主题帖访问校验的登录用户可发帖，发帖后自动成为 PARTICIPANT
  - COLLABORATORS：仅 OWNER/COLLABORATOR 可发帖
  - PLAYERS：仅 playerMarked=true 的参与人可发帖，管理者绕过该限制
- 已发布帖在创建帖子同一事务中写入 `post.created` Outbox，由 PostEventsListener 解耦处理 @提及、通知和 Redis 投影
- 编辑使用乐观锁 version 防止并发编辑冲突，且仅作者可编辑；删除允许作者或 OWNER/COLLABORATOR 软删除他人楼层/回复
- `post.created` 事件携带发帖时 `authorRole` 与 `authorPlayerMarked` 快照，订阅通知不读取异步处理时的当前角色
- 通知和最近动态摘要会在原文位置显示 `表达式=总计`；纯骰子帖也能生成摘要。编辑骰子节点不发射 `post.created`

## 创建幂等

- OpenAPI 创建 DTO 暴露可选 UUID `clientRequestId`；相同作者、请求 ID 和载荷只创建一个 Post 并返回首次响应。
- 重试不重复分配楼层号，`eventKey=post-created:{postId}` 保证 Outbox 事件幂等；同一请求 ID 用于不同载荷返回 409。
- 数据库唯一约束兜底并发双请求。
- 楼层列表默认按 floorNumber ASC 排序，`order=NEWEST` 时按 floorNumber DESC 排序；排序方向属于游标查询条件，切换后必须从第一页重新读取
- 楼层列表的可选 `authorId` 只接受当前主题的楼主、协作者或已标记玩家；普通参与者返回空页。作者、排序与 cursor 属于同一主楼层查询范围，切换后必须从第一页重新读取；省略作者时原有查询与响应不变
- 主楼层作者候选先按当前子贴的未删除主楼层取实际作者，再保留楼主、协作者或已标记玩家；不会返回只在其他子贴发言的成员
- 主楼层顺序不影响内嵌楼中楼；内嵌回复始终按 createdAt ASC、id ASC 稳定返回最早 5 条，`parentPostId + createdAt` 复合索引支撑上百条回复的分页读取
- 独立楼中楼可切换 `OLDEST` / `NEWEST` 稳定顺序；`authorId` 只允许筛选当前仍为帖内玩家、楼主或协作者的用户，角色不再符合时返回空页。排序与作者均属于游标查询条件，客户端切换后必须从第一页重新读取。
- 楼中楼作者候选先按当前主楼层的未删除回复取实际作者，再应用相同角色限制；不会返回只在主题帖其他楼层回复的成员
- 独立楼中楼阅读页复用 `GET /posts/:id` 获取原楼层及主题帖/子贴导航上下文，再用 `GET /posts/:id/replies` 分页读取回复；replies 接口拒绝以正文或楼中楼回复作为讨论根
- 楼层列表响应中每个楼层内嵌 `replies` 字段（前 5 条楼中楼回复），含 `author` 和 `replyToPost`；`replyToPost` 关联被回复的目标帖并带出其 `author`（前端据此显示「回复 @xxx」上下文）；`_count.replies` 提供回复总数，超过 5 条时前端显示"查看全部 N 条回复"入口跳转至独立楼中楼界面
- 内嵌回复使用窗口函数一次选出每个楼层前 5 条 ID，再一次批量加载作者、骰子和回复目标；一页楼层的回复查询固定为 2 次，不随有回复的楼层数增长
- 楼中楼回复稳定链接格式为 `/threads/{threadId}/posts/{parentPostId}/replies?post={replyId}`，由前端根据现有响应字段生成，不新增后端端点
- 主楼层稳定链接格式为 `/threads/{threadId}?post={postId}`，由前端根据现有响应字段生成，不新增后端端点
- 子贴正文通过 `PUT /subthreads/:subthreadId/body` upsert：无正文时创建 kind=BODY 帖（floorNumber=null），有正文时乐观锁更新（version 不匹配返回 409）。后端把子贴的 kind=BODY 帖映射回响应字段 `bodyPost`（不再有 `bodyPostId`），编辑器依赖 `subthread.bodyPost` 加载可编辑正文
- `_count.posts`（子贴与线程）只统计楼层（kind=FLOOR），正文（kind=BODY）不计入
- 楼层列表接口只返回 kind=FLOOR，不含正文；正文经详情接口的 `bodyPost` 字段返回

## 设计决策

- **楼层编号事务内分配**：`SELECT MAX + 1` 在事务内执行，防止并发发帖导致的编号冲突和空洞
- **楼中楼平级设计**：所有回复共享 parentPostId，通过 replyToPostId 区分回复目标，避免无限嵌套的 UI 复杂度和查询复杂度
- **独立阅读页不新增数据模型**：原楼层只在视觉上充当讨论正文，存储语义仍为 FLOOR；其下回复继续通过 parentPostId 平级关联
- **可靠事件解耦 @提及和通知**：发帖服务不直接处理用户匹配和通知接收者计算，只在写事务记录 Outbox；PostEventsListener 异步处理且失败可重试，通知事件键和数据库权威计数覆盖保证幂等
- **主体正文保护**：子贴正文（kind=BODY）不可删除，删除它等同于删除子贴；通过 kind=BODY 判断阻止误删。如需移除正文请删除整个子贴
