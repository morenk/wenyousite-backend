# 帖内 RP 身份 v1

HTTP 事实源为 `contracts/openapi.json`，版本 `5.33.0-dev.20261004.1`。本功能不改变 Markdown v5 的存储语法；Foundation 同步本页和 `contracts/thread-identity.v1.fixtures.json`，无需变更 token 包版本。

## 范围与权限

每账号每主题一个稳定身份 ID；所有子贴、BODY、楼层与楼中楼共享设置。楼主本人、COLLABORATOR 或 playerMarked=true 可设置，普通参与人不可设置。原有阅读、发言、治理、拉黑、订阅及 userId 过滤独立生效。仅楼主可开关。默认关闭，老数据不回填。

`GET /threads/{threadId}/identity`（threadIdentitiesMine，AuthRead）返回本人的 enabled、eligible、canEdit、identity、display、account、identityToken。
`GET /threads/{threadId}/identities/{userId}`（threadIdentitiesFindUser，OptionalAuth）返回当前身份卡；非本人不返回编辑资料 identity 和 identityToken，只读取可访问主题及未拉黑账号。历史卡从楼层 author.rpIdentity 取得“本条身份”，再用此端点取得“当前身份”和真实账号。
`PUT /threads/{threadId}/identity`（threadIdentitiesUpdate，Auth）更新 nickname、avatarMediaId。省略字段保留，null 清除；clearNickname/clearAvatar=true 也可显式单项清除，供省略 null 的生成客户端使用。同一项不允许同时设非空值和清除。可传 version 防止并发覆盖。
`DELETE /threads/{threadId}/identity`（threadIdentitiesClear，Auth）清除当前两项资料，保留稳定 ID 和历史。
`PATCH /threads/{threadId}/identity-settings`（threadIdentitiesSetEnabled，Auth）请求 `{ enabled: boolean }`，仅楼主可操作。独立设置入口不混入 aggregate save。

昵称去除首尾空白，空字符串相当于清除；最多24字符，允许重名、空格和标点，禁止方括号、反斜线、HTML括号、控制/格式字符。头像通过原 AVATAR 上传入口得到本人已完成 mediaId，不接受任意 URL。昵称与头像分别缺省到账号资料；两项都清除后 display=null。

## 显示投影

真实账号 `id/username/avatar` 始终保持原义。帖内作者、replyToPost.author、搜索内容作者新增可选 `rpIdentity: { id, nickname, avatar, avatarDisplay? } | null`。有效时优先显示其中昵称和头像，否则显示原账号。头像变体同时遵守媒体治理状态。Topic 题头 owner、成员 user、mention候选和作者筛选目录使用当前身份；历史楼层使用发表时快照，不能以当前目录资料覆盖。ThreadBodyPost 新增可选 author 和 mentionIdentities。详情新增可选 rpIdentityEnabled，缺失按 false。

筛选和订阅始终绑定账号 ID，一个账号一项；作者响应字段为现有 id，非新的角色 ID。曾以 RP 发言的账号撤资格后仍可筛选历史全部发言。管理列表以账号用户名为主、角色为辅。全站用户目录、主页、私聊、关注与首页作者不注入 RP。

通知仍以真实账号识别；有权限读取的帖子通知 payload 可带可选 rpIdentity 补充“以某角色”，关闭或目标不可用时不展示。搜索与档案导出使用和帖子一致的历史作者与提及；导出不改变数据库正文。

## 发言确认与历史

CreatePostDto、UpsertBodyDto、CreateSubthreadDto、SaveThreadAggregateDto 新增可选 identityToken。新建发言或首次 BODY 时发送编辑器上显示的本人 token；编辑已有正文保持原作者，不要求新 token。

后端在与主题设置/成员资格相同的聚合锁内重新校验；提供 token 但失效，或省略 token 而存在有效 RP，返回 HTTP 409 / RP_IDENTITY_CHANGED=40011，不写入任何发言/自动加入/Outbox。客户端保留草稿，重新 GET 自己身份并显示新名字，用户确认后新请求提交。无有效 RP 且省略 token 的旧客户端继续以账号发表；有效 RP 下旧客户端须升级或清除自己的资料，不能静默换身份。

token只关联本帖身份设置、资格、开关专用版本与展示缺省字段，不受标题变更或发言更新时间影响。成功发言的同 clientRequestId 网络重试先返回原帖，后续改名/关闭不能导致重复发帖；同幂等键不同正文仍按原冲突规则拒绝。客户端冻结待重试 payload；明确409未写入、重新确认身份后使用新幂等键。

修改和清除仅影响后续新发言，编辑旧正文不换作者。关闭时全部已保存 RP 显示恢复账号，重新开启恢复快照。开启前与关闭期间新发言不追溯套用。资格撤销保留旧历史，后续账号模式。快照有真实媒体引用，换头像后旧图不被孤儿回收；治理移除仍令 URL 与变体都不可展示。账号注销不暴露历史身份。

## Markdown 提及

正文继续 `[@角色名](/users/{userId})`；不得以昵称查找发送账号，普通文本 `@用户名` 沿用旧协议，普通 `@角色名` 不引入新的模糊解析。

候选 id/username/avatar 保持账号字段，relation 增加 OWNER/COLLABORATOR（不假称玩家），新增 rpIdentity；查询同时匹配 username 与当前 nickname，支持空格及标点。候选范围为原关注/玩家加帖内楼主和协作者，私帖与拉黑照旧过滤。

每条帖子新增可选 `mentionIdentities: [{ userId, label, displayName, identityId }]`。label 是源 Markdown 标签（不含 @），以 userId + label 匹配渲染节点，不能只按 userId 覆盖同一作者的不同历史称呼。编辑与重新保存继续用源 content，不把展示名写回正文。关闭时 displayName=账号用户名，开启时已验证的 RP 标签显示原 label；普通正文名字不变。

启用 RP 时，服务端在写事务内验证新增标签属于目标账号的当前/已登记历史帖内昵称；已存在正文中的 userId+label 原样保留，包括无快照的旧账号提及，关闭 RP 的旧账号提及写语义保持兼容。服务端，保存插入时标签。对方在选择后改名仍可接受已登记旧名；伪造其他用户角色名返回 HTTP 409 / RP_MENTION_CHANGED=40012，保留草稿并要求重新选择提及。未知/注销或已拉黑目标在读取时显示不可用用户，不泄露 RP。代码和转义节点没有提及语义。一个账号出现多个不同标签仍只按原账号通知且保持原去重。

## 验收与发布

先兼容后端，再 Foundation 语义与 Web/Mobile 消费；不删除旧 username/avatar、旧 Markdown 提及或旧无RP写接口。迁移只加表和nullable/default字段。隔离测试覆盖权限、跨帖隔离、关闭重开、改名/头像历史、clear 单项、提及归属、重名、撤权竞态、幂等重试、搜索/通知/导出及媒体引用。UI 实际画面与负责人验收独立于后端自动测试。
