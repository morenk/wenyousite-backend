# RP 身份资料楼层引用

HTTP 事实源为 `contracts/openapi.json`（`5.36.0-dev.20261005.1`）；固定语料为 [rp-identity-profile-post.v1.fixtures.json](../contracts/rp-identity-profile-post.v1.fixtures.json)。正文仍复用原 Markdown 协议与读取协商，不新增链接语法，不激活角色提及新写。

## 能力与写入

`GET /meta` 的可选 `capabilities.rpIdentityProfileSupported=true` 表示支持本扩展；缺失按 false。旧后端不接受新增 DTO 字段，因此能力缺失时客户端不得发送 `profilePostId`、`clearProfilePost`。旧请求省略字段，保留原绑定。

`CreateRpIdentityDto`、`UpdateRpIdentityDto`、`UpdateThreadIdentityDto` 新增：

| 字段 | 语义 |
|---|---|
| profilePostId?: string \| null | 本主题内稳定 post ID；省略保持原值，null 解绑。创建省略为 null。禁止任意 URL。 |
| clearProfilePost?: boolean | true 显式解绑，适用于生成器省略 JSON null 的客户端；不能与非空 profilePostId 同时提供。 |

operationId 不变：`rpIdentitiesCreate`、`rpIdentitiesUpdate`、`threadIdentitiesUpdate`。指定角色更新仍必填 version，旧 single 可选 version 沿用原兼容行为；新客户端须使用指定角色端点。保存时在主题事务锁内同时验证 actor 资格、版本以及目标当前可读、存活、属于同主题。允许 BODY、主楼层和楼中楼，跨子贴、他人或楼主代贴均可；同一 post 可被多个角色引用。跨主题、不存在、软删除、已删父楼/子贴、双向拉黑等统一 404/POST_NOT_FOUND=40403，不泄露目标详情。非法 ID/URL 等 DTO 格式错误为 400/VALIDATION_ERROR=40000；清除冲突、空修改为 400/BAD_REQUEST=40001；主题/角色访问与 403/409 原规则不变，版本冲突 409/40002。

资料是附加信息；仅绑定资料不能创建空角色，也不令昵称/头像均空的角色变为有效 RP。新建仍至少需要非空昵称或头像。旧 single DELETE 继续只清昵称/头像，省略本字段保留原绑定，绝不隐式解绑其他角色；新 UI 的“解绑资料”明确传 clearProfilePost=true。归档继续保留记录且不再展示当前资料，恢复/替换角色 ID 不在本功能范围。

## 当前资料与读取

本人 `ThreadIdentityProfileDto.profilePostId?: string|null` 是保存的原绑定，用于编辑回显；即使角色暂时关闭/失去资格或目标不可读，也不以展示层 null 覆盖该字段。归档角色仍按原规则 identity=null。

`ThreadIdentityStateDto`（含派生 `RpIdentityStateDto`、集合内角色）新增可选 `profilePostStatus` 和 `profilePostId`：

| profilePostStatus | profilePostId | 展示含义 |
|---|---|---|
| NONE | null | 未绑定，或当前身份关闭、无资格、空资料、归档；不展示资料空块。 |
| AVAILABLE | ID | 当前查看者可读的资料引用；继续授权读取正文。 |
| UNAVAILABLE | null | 有效角色曾绑定资料，但目标当前不可读；只显示统一不可用，不返回原因、ID、标题或摘要。 |

旧服务响应缺少字段按不支持处理。资料卡必须读取同一 identityId 的当前状态，历史作者昵称/头像仍取原发言快照；绑定不加入任何 author/mention snapshot，也不把别的角色资料当“当前”。

正文使用现有 `postsFindById`（GET /posts/{id}，OptionalAuth）读取，每次打开资料卡重新请求角色状态及正文。该接口已有 content、mediaDisplays、mentionIdentities、diceRolls、thread/subthread 的 id/title、kind/floorNumber/replyNumber/parentPostId 和 parentPost.floorNumber，足以渲染完整原文与跳转坐标。新端照旧发送 Markdown 6 读取 header；不修改源、不另存副本、不增加访问权限。原楼层编辑后下次读取立即得到当前正文及 version/editedAt。

身份 GET 和 post 详情返回 `Cache-Control: private, no-store`。消费者缓存必须按登录查看者、threadId、identityId、postId 和读取能力隔离；刷新开始先隐藏旧正文，遇 NONE/UNAVAILABLE、403/404、注销或访问撤销清除旧正文与媒体，不从离线/上一角色缓存回退。授权返回之后发生的权限变化不可能撤回已显示字节，客户端在重开/重新校验时必须重新授权。资料身份绑定不是媒体引用副本，原帖删除/治理继续控制媒体生命周期。

## 并发与迁移

新增 nullable `thread_identities.profile_post_id` 外键，硬删除 post 时 SET NULL；普通软删保留绑定并投影不可用。无唯一约束，多个角色可引用同一 post。只保存 ID，不保存正文或坐标。

资料更改增加既有乐观锁 version。新增内部 author_version，从历史 version 回填，发表 token 的组成保持原值；只资料更改、昵称/头像同值重存不改变 token，实际昵称/头像变动才递增 author_version。资格、开关、删除与有效显示变化仍令原 token 失效。不改变发言 UUID 幂等指纹或历史作者。

迁移为追加列/索引/外键，无旧内容回填与删除。回切旧二进制虽然可忽略资料列，但旧写会只增加 version、不增加 author_version，可能使重新升级时 token 版本语义漂移；因此回滚须停止角色编辑并评估版本同步，以前滚修复为首选，不自动降库删除资料。已有多角色唯一约束回滚限制仍适用。

## 验证与发布边界

隔离测试须覆盖他人代贴、跨子贴与楼中楼、同帖共享引用、跨帖/不可读拒绝、版本并发、原文更新、父楼/子贴/正文删除、拉黑与私帖权限变化、关闭重开、旧字段省略/旧 single clear、旧作者 token 迁移与资料独立版本。写入只通过已核验的一次性 PostgreSQL/Redis/API 环境；登记 runId 与清理结果。此契约提交不代表完整后端门禁已通过或已经部署。
