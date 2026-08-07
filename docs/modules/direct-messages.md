# 私聊模块

## 范围

私聊仅支持一对一会话，不追求聊天软件级实时性。所有写操作要求登录且邮箱已验证；历史读取允许已登录用户在邮箱状态变化后继续访问自己的记录。

支持纯文本、每条一张图片或一个收藏表情；图片和表情不能与彼此或正文组合发送。不支持群聊、输入状态、在线状态、消息编辑、站内搜索、推送、端到端加密或消息举报。

## 模型

| 模型 | 职责 |
|------|------|
| `DirectConversation` | 唯一用户对、请求发起/接收方、会话状态和最后消息时间 |
| `DirectConversationParticipant` | 每位参与者自己的归档状态 |
| `DirectMessage` | 正文、单图或独立表情资产关联、客户端幂等键、本人未读和撤回占位 |

用户对按 ID 排序写入 `firstUserId/secondUserId`，并以唯一索引保证两人只有一个会话。`requesterId/recipientId` 表示最近一次建立请求时的方向，不参与用户对唯一性。

## API

| 方法 | 路径 | 守卫 | 用途 |
|------|------|------|------|
| GET | `/direct-conversations?view=INBOX\|REQUESTS\|ARCHIVED` | AuthRead | 会话列表，游标分页 |
| POST | `/direct-conversations` | Auth | 发送首条消息并创建或恢复会话 |
| GET | `/direct-conversations/unread` | AuthRead | 已接受会话未读数、待处理请求数及合计 |
| GET | `/direct-conversations/by-user/:userId` | AuthRead | 用户主页发起前查询联系状态 |
| GET | `/direct-conversations/:id` | AuthRead | 会话详情 |
| GET | `/direct-conversations/:id/messages` | AuthRead | 历史或 `after` 增量消息，按时间正序 |
| POST | `/direct-conversations/:id/messages` | Auth | 向已接受会话发送消息 |
| PATCH | `/direct-conversations/:id/request` | AuthRead | 接受或拒绝请求；接受时额外校验邮箱 |
| PATCH | `/direct-conversations/:id/archive` | AuthRead | 设置当前参与者的归档状态 |
| POST | `/direct-conversations/:id/read` | AuthRead | 标记当前用户实际展示到的消息为已读 |
| DELETE | `/direct-messages/:id` | AuthRead | 发送者十分钟内撤回 |

## 状态与请求规则

```text
NEW ──互相关注──> ACCEPTED
  └──非互关────> PENDING ──接收方接受/主动回复──> ACCEPTED
                         ├──接收方拒绝────────> DECLINED
                         ├──任一方拉黑────────> DECLINED
                         └──发起方撤回首条────> CANCELED
```

- 全部已验证用户都可从用户主页发起；没有通用用户搜索入口。
- 互相关注直接进入 `ACCEPTED`；其他关系只允许一条首条消息，接收方处理前发起方不能继续发送。
- 拒绝会删除请求中的消息。原发起方不能再次申请；原接收方之后主动联系时可以建立会话。
- 接收方在待处理状态下主动回复等价于接受请求，并把原首条消息标记为本人已读。
- 拉黑会原子地把待处理请求改为 `DECLINED` 并删除请求消息。已接受会话历史保留，但双方不能继续发送。
- 注销账号的既有历史保留，另一方看到“已注销用户”，会话只读。

## 消息、已读与撤回

- `content` 为最多 1000 字的纯文本，保留换行，不解析 Markdown；客户端可安全地把 `http/https` 文本显示为链接。
- `mediaId` 必须属于发送者、状态为 `COMPLETED`，且未绑定其他私聊消息。一条消息最多一张图。
- `stickerAssetId` 必须仍在发送者的私有收藏中；纯表情消息不重复上传文件，服务端返回独立 `sticker` 字段，并把同一图片映射到 `media` 作为旧客户端回退。
- `clientRequestId` 是 UUID v4，并以 `(senderId, clientRequestId)` 唯一；客户端重试同一次发送必须复用它。
- 已读状态只用于当前用户的未读计数，不在消息响应中向发送者暴露，因此没有已读回执。
- `POST /read` 使用已经显示的最后一条消息作为锚点，只更新该锚点及之前发送给当前用户的消息。
- 发送者可在创建后十分钟内撤回。已接受会话保留撤回占位并解除图片/表情关联；待处理的首条消息被撤回时删除请求消息并转为 `CANCELED`。

## 列表、归档与轮询

- `INBOX` 包含已接受会话和本人发出的待处理请求；`REQUESTS` 仅包含本人收到的待处理请求；`ARCHIVED` 读取当前参与者已归档的可见会话。
- 归档仅影响本人。任一方发送新消息时，两人的归档状态都会清空，使会话重新出现在主列表。
- Web/Flutter 建议活动会话每 10 秒使用 `after=<lastMessageId>` 拉取增量；会话列表和未读合计每 30 秒刷新。后台页面不要求继续轮询。

## 限流与图片安全

- 每位用户默认最多发送 30 条/分钟，由 `DIRECT_MESSAGE_RATE_PER_MINUTE` 配置。
- 每位用户默认最多发起 10 个陌生消息请求/天，由 `DIRECT_MESSAGE_REQUEST_RATE_PER_DAY` 配置。
- 私聊图片沿用媒体模块的 10 MB 上传、MIME 校验和公开 URL；表情资产使用表情模块规范化后的 WebP。客户端必须提示用户不要发送敏感图片；收到的陌生请求图片和表情应在点击前不加载。
- 未撤回私聊消息的图片计入媒体存活引用；拒绝、取消或撤回释放关联后，由孤儿媒体回收处理。
