# 帖内 RP 身份

HTTP 事实源为 `contracts/openapi.json`，版本 `5.34.0-dev.20261005.1`。本功能不改变 Markdown v5 的存储语法；Foundation 同步本页和 `contracts/thread-identity.v1.fixtures.json`，无需变更 token 包版本。

## 范围与权限

每账号每主题最多十个未归档身份，每个角色有稳定且不复用的 ID；所有子贴、BODY、楼层与楼中楼共享设置。楼主本人、COLLABORATOR 或 playerMarked=true 可设置，普通参与人不可设置。原有阅读、发言、治理、拉黑、订阅及 userId 过滤独立生效。仅楼主可开关。默认关闭，老数据不回填。

`GET /threads/{threadId}/identity`（threadIdentitiesMine，AuthRead）返回本人的 enabled、eligible、canEdit、identity、display、account、identityToken。
`GET /threads/{threadId}/identities/{userId}`（threadIdentitiesFindUser，OptionalAuth）返回当前身份卡；非本人不返回编辑资料 identity 和 identityToken，只读取可访问主题及未拉黑账号。此端点仅为旧单身份兼容卡；多身份历史卡必须使用下述 identityId 端点，不可把另一个角色当作当前身份。
`PUT /threads/{threadId}/identity`（threadIdentitiesUpdate，Auth）更新 nickname、avatarMediaId。省略字段保留，null 清除；clearNickname/clearAvatar=true 也可显式单项清除，供省略 null 的生成客户端使用。同一项不允许同时设非空值和清除。可传 version 防止并发覆盖。
`DELETE /threads/{threadId}/identity`（threadIdentitiesClear，Auth）清除当前两项资料，保留稳定 ID 和历史。
`PATCH /threads/{threadId}/identity-settings`（threadIdentitiesSetEnabled，Auth）请求 `{ enabled: boolean }`，仅楼主可操作。独立设置入口不混入 aggregate save。

### 多角色集合与兼容主身份

新客户端使用以下五个端点（operationId 前缀 rpIdentities）。列表只返回本人未归档角色，不改变原账号权限；未登录列表401，私帖或被拉黑目标仍按集中可见性404处理。

| 方法 / 路径 | operationId | 请求与结果 |
|---|---|---|
| GET /threads/{threadId}/rp-identities | rpIdentitiesList | RpIdentityCollectionDto：identities、activeCount、limit=10、compatibilityIdentityId、defaultIdentityId、account、enabled/eligible/canEdit |
| POST /threads/{threadId}/rp-identities | rpIdentitiesCreate | CreateRpIdentityDto：nickname、avatarMediaId 或 clear flags；至少一个非空自定义项；201 RpIdentityStateDto |
| GET /threads/{threadId}/rp-identities/{identityId} | rpIdentitiesFind | OptionalAuth；按该角色读取 RpIdentityStateDto，包括 deleted 状态；绝不改查其他角色 |
| PUT /threads/{threadId}/rp-identities/{identityId} | rpIdentitiesUpdate | UpdateRpIdentityDto：必填 version + 至少一项修改；200 RpIdentityStateDto |
| DELETE /threads/{threadId}/rp-identities/{identityId} | rpIdentitiesRemove | JSON DeleteRpIdentityDto：必填 version；200 归档后的 RpIdentityStateDto；同角色已归档重复删除返回归档状态 |

RpIdentityStateDto 继承旧 state 字段，增加 identityId、deleted、compatibilityIdentity、canDelete。非本人不返回编辑资料和 token。已归档角色即使本人也不返回 identity/display/token，仅保留账号和状态；“当时身份”取自原发言快照。关闭或失去资格时 display=null，不泄露当前 RP 投影；本人可读编辑资料，但不能修改，仍可删除（canDelete）。无权限角色、跨帖或跨账号编辑404；版本冲突409/40002。

迁移把已有单身份标记为明确兼容主身份，原 ID、快照和别名不变。历史上从未建立过兼容主身份时，新集合首次创建成为兼容主身份。主身份被归档后，集合后续创建不自动顶替；旧 single GET 返回空身份，旧 PUT 可显式新建兼容身份并分配新 ID。旧 single CLEAR 只清当前兼容主身份两项资料，绝不清其他角色或选择另一个角色。全部旧端点保留。

未归档角色均计入十个名额；清空两项保留 ID 且占名额，display=null，不可 RP 发表。DELETE 归档释放名额，历史快照、别名和必要媒体引用保留。新建空资料返回400/40001；保存成功前不创建空占位。角色 POST 不按相同字段去重，也没有 clientRequestId；结果不明时保留表单并先刷新集合让用户核对，不自动重试或按同名猜测新角色。只有发言创建的原幂等键冻结完整身份选择。并发创建在主题锁内计数与写入，达到十个时409/RP_IDENTITY_LIMIT=40013，不抢占或覆盖任何现有身份。更新昵称或头像只改变指定角色。

集合按 createdAt、id 稳定排序。defaultIdentityId 只用于没有草稿的新编辑器初始化：可用兼容主身份优先，否则第一个有效角色；没有有效 RP 时为 null。恢复草稿保留其显式 ACCOUNT/RP、identityId 和 token；新建角色成功可显式选中新角色，编辑其他角色不得静默切换已选角色。列表不是发表授权，提交仍须事务重校验。

昵称去除首尾空白，空字符串相当于清除；最多24字符，允许重名、空格和标点，禁止方括号、反斜线、HTML括号、控制/格式字符。头像通过原 AVATAR 上传入口得到本人已完成 mediaId，不接受任意 URL。昵称与头像分别缺省到账号资料；两项都清除后 display=null。

## 显示投影

真实账号 `id/username/avatar` 始终保持原义。帖内作者、replyToPost.author、搜索内容作者新增可选 `rpIdentity: { id, nickname, avatar, avatarDisplay? } | null`。有效时优先显示其中昵称和头像，否则显示原账号。头像变体同时遵守媒体治理状态。Topic 题头 owner、成员 user、mention候选和作者筛选目录仅使用当前兼容主身份（无则账号）；历史楼层使用发表时快照，不能以当前目录资料覆盖。ThreadBodyPost 新增可选 author 和 mentionIdentities。详情新增可选 rpIdentityEnabled，缺失按 false。

筛选和订阅始终绑定账号 ID，一个账号一项；作者响应字段为现有 id，非新的角色 ID。目录包含当前可见范围内所有实际发言账号（包括从未使用 RP 的普通读者与退出成员）；角色仅用于展示和排序。撤资格后仍可筛选历史全部发言。管理列表以账号用户名为主、角色为辅。全站用户目录、主页、私聊、关注与首页作者不注入 RP。

通知仍以真实账号识别；有权限读取的帖子通知 payload 可带可选 rpIdentity 补充“以某角色”，关闭或目标不可用时不展示。搜索与档案导出使用和帖子一致的历史作者与提及；导出不改变数据库正文。

## 发言确认与历史

CreatePostDto、UpsertBodyDto、CreateSubthreadDto、SaveThreadAggregateDto 接受可选 identityMode（ACCOUNT | RP）、identityId 与 identityToken。每次新建楼层、楼中楼或首次 BODY 可选身份；同一账号可交替使用站内账号与本主题不同帖内角色。

- ACCOUNT：本条明确使用站内账号，不写 RP 快照；忽略 identityToken，不因无关的 RP 开关、角色资料或使用资格变化拒绝。阅读、发言和管理权限仍实时检查。
- RP：新客户端显式提供 identityId 和该角色 identityToken；角色须属于本账号、本主题且未归档、资料有效，当前开启且具备资格。不满足时返回 HTTP 409 / RP_IDENTITY_CHANGED=40011，不能静默降级为账号。
- 兼容旧客户端省略 identityId：只查询明确兼容主身份，绝不从多个角色中任选。提供其他角色 token 却省略 ID 会冲突，不能借此切换角色。
- 省略 identityMode：保留原确认规则；存在有效 RP 必须有 token，没有有效 RP 且不带 token 的旧请求按账号发表。显式 ACCOUNT 与省略 mode 在幂等请求中视为不同输入。

编辑已有正文保持原作者，忽略 identityMode、identityId 和新 token。新建主题尚未开放帖内身份，首正文沿用站内账号。逐条选择只组合整套身份，不提供头像与昵称分别切换。

后端在与主题设置/成员资格相同的聚合锁内重新校验；RP 或省略 mode 时提供 token 但失效，或省略 token 而存在有效 RP，返回 HTTP 409 / RP_IDENTITY_CHANGED=40011，不写入任何发言/自动加入/Outbox。客户端保留草稿，重新 GET 角色集合/同角色身份卡并显示名字，用户确认后新请求提交。无有效 RP 且省略 token 的旧客户端继续以账号发表；有效 RP 下旧客户端须升级或清除自己的资料，不能静默换身份。

token只关联所选稳定身份 ID、该角色版本、资格、开关专用版本与实际展示缺省字段；修改角色 B 不影响已选角色 A 的 token，不受标题变更或发言更新时间影响。成功发言的同 clientRequestId 网络重试先返回原帖，后续改名/关闭不能导致重复发帖；同幂等键不同正文、identityMode、identityId 或 identityToken 均按原冲突规则拒绝（帖子409/CONFLICT，子贴409/IDEMPOTENCY_KEY_REUSED=40912）。完整 mode/id/token 包含在冻结payload中；成功重试先比较原指纹再返回原记录，不因成功重试时角色变化而重新校验。客户端冻结待重试 payload；明确409未写入、重新确认身份后使用新幂等键。

首次 UpsertBody 没有 clientRequestId；超时重试时如果首请求已创建，省略 version 的重试返回版本冲突，不覆盖原正文或身份。客户端可回读并展示已保存正文与作者；相同正文不能严格证明是原请求，禁止自动附新 version 强行覆盖。

修改和清除仅影响后续新发言，编辑旧正文不换作者。关闭时全部已保存 RP 显示恢复账号，重新开启恢复快照。开启前与关闭期间新发言不追溯套用。资格撤销保留旧历史，后续可明确选择 ACCOUNT；尚停留 RP 的草稿须确认改为 ACCOUNT 后再发。快照有真实媒体引用，换头像后旧图不被孤儿回收；治理移除仍令 URL 与变体都不可展示。账号注销不暴露历史身份。

## Markdown 提及

正文继续 `[@角色名](/users/{userId})`；不得以昵称查找发送账号，普通文本 `@用户名` 沿用旧协议，普通 `@角色名` 不引入新的模糊解析。

候选 id/username/avatar 保持账号字段，relation 增加 OWNER/COLLABORATOR（不假称玩家），新增 rpIdentity；查询同时匹配 username 与当前兼容主身份 nickname，支持空格及标点。候选范围为原关注/玩家加帖内楼主和协作者，私帖与拉黑照旧过滤。

每条帖子新增可选 `mentionIdentities: [{ userId, label, displayName, identityId }]`。label 是源 Markdown 标签（不含 @），以 userId + label 匹配渲染节点，不能只按 userId 覆盖同一作者的不同历史称呼。编辑与重新保存继续用源 content，不把展示名写回正文。关闭时 displayName=账号用户名，开启时已验证的 RP 标签显示原 label；普通正文名字不变。

启用 RP 时，服务端在写事务内验证新增标签属于目标账号的兼容主身份的当前/已登记历史昵称；已存在正文中的 userId+label 原样保留，包括无快照的旧账号提及，关闭 RP 的旧账号提及写语义保持兼容。保存插入时标签。对方在选择后改名仍可接受已登记旧名；伪造其他用户角色名返回 HTTP 409 / RP_MENTION_CHANGED=40012，保留草稿并要求重新选择提及。未知/注销或已拉黑目标在读取时显示不可用用户，不泄露 RP。代码和转义节点没有提及语义。一个账号出现多个不同标签仍只按原账号通知且保持原去重。

## 验收与发布

先兼容后端，再 Foundation 语义与 Web/Mobile 消费；不删除旧 username/avatar、旧 Markdown 提及或旧无RP写接口。迁移保留原角色表和字段，回填兼容锚点，解除每账号每主题唯一约束并新增活动兼容锚点的部分唯一索引；无正文或身份 ID 重写。隔离测试覆盖权限、跨帖隔离、关闭重开、改名/头像历史、clear 单项、提及归属、重名、撤权竞态、幂等重试、搜索/通知/导出及媒体引用。UI 实际画面与负责人验收独立于后端自动测试。

### 隔离回归与合成预览入口

通过仓库隔离入口执行 `pnpm exec tsx scripts/e2e-runner.ts --source --suite=thread-identity`，每次运行登记独立 PG/Redis/上传目录，完成或失败后按该轮归属清理。`scripts/thread-identity.integration.ts` 包括实际 HTTP 四种创建路径、角色权限、混合身份、历史提及、清除资料、媒体引用、幂等模式及排队关闭竞态。

无法取得当天已核验真实快照时，`pnpm exec tsx scripts/thread-identity-preview.ts` 仅创建明确标记的合成样本，沿用已提交的 sample preview 隔离资源与快照流程，禁止回落线上或旧真实快照。需先完成 build；输出只有 consumer、账号文件、内容文件的私有路径与非秘密定位。五种账号含楼主、协作者、两个同昵称玩家与读者；样本包含同账号 ACCOUNT/RP、历史昵称、回复提及及第二主题。实际密码仅保存私有文件，不能打印或提交。同一 `rp-identity-v1` 会话跨轮复用，停止与删除依照 [实时预览入口](dev-preview-session.md)。合成样本与真实快照验收分别报告。

合成联验描述中的 `snapshot.sourceKind=synthetic-thread-identities` 标明数据由本轮隔离样本生成；消费者横幅必须显示“隔离合成样本”，不得把该描述的日期与哈希称为真实用户快照验收。私有账号与内容清单另以 `isolatedSample: true` 和相同 `runId` 绑定会话。

### 多角色迁移与回滚

`20261005050000_multiple_thread_identities` 回填已有角色 compatibility_identity，新增 deleted_at 和新发言所选身份的请求指纹，保留媒体外键/治理触发器。删除角色为归档，不触发头像物理删除。由于数据库已允许同帖同账号多行，旧单角色后端的唯一键 upsert 不能安全直接回切；消费端旧协议仍兼容，但服务端回滚应前滚修复并保留多角色查询、媒体引用和索引。禁止自动删除角色以恢复旧唯一约束。部署另行授权，本任务不执行迁移到公网。

多角色不引入角色指向型提及，Markdown 仍为 v5；候选每账号一次并使用明确兼容主身份。选择其他角色发表不会改变账号的 @ 目标或兼容主身份。历史作者卡按快照 identityId 查同一个角色；只有 ACCOUNT 作者头像直接进入账号主页。筛选、订阅、拉黑和通知继续按账号聚合。从角色发言来源触发的既有提及入口使用真实账号用户名或当前兼容主身份已验证标签，不能将任意其他角色昵称直接当作账号级 @ 标签。

## 平级身份（5.35兼容扩展）

本节覆盖前文主身份/默认优先规则：新空白编辑器默认 ACCOUNT，defaultIdentityId=null。所有RP角色平级；账号目录/题头/成员/订阅使用站内资料；compatibilityIdentity仅旧single协议内部锚点。新端提及任一角色或显式账号采用 [Markdown6分阶段扩展](markdown-v6-role-mentions.md)，旧bare语法不删除。身份卡内不新增提及或筛选按钮。
