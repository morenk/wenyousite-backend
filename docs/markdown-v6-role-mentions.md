# Markdown 6 平级身份提及扩展（分阶段激活）

本扩展不改变 `/meta.markdownContractVersion=5`，不会让旧 App 进入全局强制升级。兼容后端、可读保源消费者、新写激活是三个独立发布阶段，本批不授权部署或激活。

## 能力与写入

读取请求头 `X-Markdown-Contract-Version: 6` 表示可保留角色源码并应用显示投影。服务端在受影响响应合并 `Vary: X-Markdown-Contract-Version`，不覆盖原有 Origin/Accept；私帖/草稿仍按会话隔离。

`/meta.capabilities.roleMentionsV6Supported`（缺失 false）表示本服务端接受新读取与写 DTO 能力字段；`roleMentionsV6WriteEnabled`（缺失 false）表示允许新增 v6 源。环境变量 `RP_MENTION_V6_ENABLED` 默认 false，隔离测试可显式 true。全局 Markdown 版本独立保持 5。

七个 DTO 新增可选 `markdownContractVersion: 6`：CreatePostDto、UpdatePostDto、UpsertBodyDto、CreateSubthreadDto、SaveThreadAggregateDto、CreateDraftDto、UpdateDraftDto。新客户端仅在 supported=true 时始终发送能力字段，包括删光原角色节点的编辑；旧后端可能拒绝未知字段。读取 header 不能替代写 DTO。普通正文和旧 bare 节点不因声明 6 或写开关关闭被拒绝。

提交正文或原存正文任一包含 v6 节点而没有能力 6：HTTP409 / 40014 MARKDOWN_CAPABILITY_REQUIRED，不修改任何正文，保留客户端草稿。此规则覆盖首次/更新 BODY、聚合编辑不变正文、普通楼层 PATCH、云草稿同槽覆盖和 PATCH；原存源不能由降级副本覆盖。

写开关关闭时，仅新增的 v6 源键拒绝 HTTP409 / 40015 ROLE_MENTIONS_DISABLED；有能力客户端仍能保存、重排、复制原文已有节点或删除节点。键为原 `sourceHref + label`，不是位置序号。写入身份 ID/token/mode 与原幂等规则不变；能力字段本身不是发言身份选择。

## 规范源码

- RP：`[@白鸦](/users/{userId}?rpIdentityId={identityId})`。
- ACCOUNT：`[@站内名](/users/{userId}?identityMode=ACCOUNT)`。
- LEGACY：`[@旧称呼](/users/{userId})`，保留旧单身份快照解释，不能声称显式 ACCOUNT。

链接使用相对用户路径、唯一且精确的参数；角色 ID 必须是合法 CUID。混合 rpIdentityId/identityMode、重复键、未知参数、空/非法 ID 拒绝40012，不回退到普通 @名字扫描。代码与转义节点不产生提及。源码 label 不含换行/右中括号，1–32字符；角色昵称维持原最多24字符规则。

RP 绑定 userId + identityId + 插入 label，仅该主题、该账号、有效且有资格角色及其自身当前/已登记别名可用于新插入。不可用、归档、跨账号、跨主题或伪造 label 返回409/40012；复制到另一主题须重新选择。原正文已有合法节点可在关闭、归档、撤资格之后保留、重排和删除，快照保持。草稿没有主题上下文，只存语法合法源，发布时必须重新验证归属，不能把草稿当成授权。

显式 ACCOUNT 仅验证账号当前 username 或服务端登记的账号历史名，绝不借用角色别名；原始 label 保持插入时值，显示使用当前账号名。账号改名事务登记旧名。旧 bare 历史标签编辑继续兼容。

同账号同昵称两个角色和账号目标是三个独立节点，任何转换不得按 userId/label 合并。通知仍按 userId 去重；筛选、订阅、管理也使用账号。

## 候选、默认与目录

`GET /users/mention-candidates?threadId=...&includeIdentities=true&q=...` 在已激活写入时返回平级账号和角色候选，最多20个目标；搜索当前角色昵称及站内用户名。仍执行主题可见性、关注/楼主/协作者/标记玩家范围及拉黑限制。排序不使用 compatibilityIdentity，不按账号去重候选。

新增可选 candidateKey（ACCOUNT:userId / RP:identityId）、targetIdentityId（账号 null）、mentionLabel（插入称呼，不带 @）、mentionHref（规范链接）。原 id/username/avatar 始终是账号字段；rpIdentity 仅表示该候选选中的角色。

includeIdentities=true 但新写开关关闭时 users=[]；canMentionAllPlayers 原语义不变。新端在 supported=true 时始终发送 includeIdentities=true；gate 关闭时不得回退旧候选。仅 supported 缺失/false 的旧后端兼容期使用旧候选并保留 bare 原语义。@全体玩家能力独立，不因 users 为空关闭。

RpIdentityCollectionDto.defaultIdentityId 固定 null，新空白编辑器默认 ACCOUNT；恢复显式草稿不改。compatibilityIdentity/compatibilityIdentityId 仅为旧 single 协议内部锚点，不是产品主角色、候选优先级或目录头像。账号范围的题头、成员、作者目录、订阅显示站内资料；历史发言/回复/通知来源仍使用发表快照。

## 读取与显示

有 header6：原 content 不变；mentionIdentities 增加 sourceHref、targetIdentityId、threadId。原 label 与 sourceHref 是匹配键；targetIdentityId 不随关闭/归档丢失，identityId 是可遮蔽的显示身份，不能作为稳定目标。显示使用 displayName。角色关闭时 displayName 回账号、identityId=null；重开恢复插入快照 label。同ID卡片查询不能指向该账号其他角色。

无 header6：仅响应副本把 v6 节点降成账号 bare 链接及安全账号 label，投影不夹带原角色 sourceHref/label/targetIdentityId。覆盖楼层、BODY、回复来源、聚合响应、搜索、通知摘要、云草稿和导出；不修改数据库源。旧写原存 v6 的检查保证降级结果不能破坏原源。既有 bare 来源行为保持兼容。

站内富文本复制可成对携带 `data-wenyou-mention-source-href`（规范 href）与 `data-wenyou-mention-source-label`（完整 @原label）；两者严格验证后恢复原源，不能信任单个属性或当前视觉文字。text/plain 使用显示投影。同主题复制/剪切/重排、引用、粗斜体编辑均保留源；跨主题发布重新验证。

导出原有 .md/.txt 是安全展示副本，关闭时显示账号，不能当成无损存储源码回写。header6 额外提供 `identity-sources.json`，包含 markdownContractVersion=6、threadId、每条发言 postId/content 原源和 mentionIdentities（原插入 label、稳定目标及当前显示投影），并明确标记原源在关闭时仍含历史称呼。无 header6 不输出此清单。新客户端读取和新清单保源，不承诺普通展示导出文件无损回写。

## 验收与回滚

固定语料见 [v6角色提及](../contracts/markdown-v6-role-mentions-fixtures.json)。验收覆盖同账号同名 A/B/ACCOUNT、改名、归档、关闭重开、非法/跨主题、旧读新读缓存、旧编辑删除全部、草稿槽覆盖、导出展示/源分离和通知去重。

新写激活必须等待 Web/Mobile 均可读保源并通过隔离验证及独立发布批准。回滚优先关闭新写开关，保留可读/旧写保护与已存数据，不能回退到会破坏 v6 原文的服务端；无旧协议删除。
