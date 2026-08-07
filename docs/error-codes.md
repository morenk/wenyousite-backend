# 业务错误码

> 本文件由 `pnpm docs:generate` 从 `ErrorCode` 生成，请勿手工维护数值。Flutter 必须按名称分支并保留 unknown fallback。

| 名称 | code | 含义 |
|---|---:|---|
| `SUCCESS` | 0 | 成功 |
| `VALIDATION_ERROR` | 40000 | 参数校验失败 |
| `BAD_REQUEST` | 40001 | 通用业务逻辑错误 |
| `OPTIMISTIC_LOCK_CONFLICT` | 40002 | 乐观锁冲突 |
| `INVALID_DICE_NOTATION` | 40003 | 骰子表达式不合法 |
| `DICE_ROLL_LIMIT_EXCEEDED` | 40004 | 单帖骰子次数超限 |
| `INVALID_DIRECT_MESSAGE` | 40005 | 私聊消息正文或附件不合法 |
| `INVALID_STICKER` | 40006 | 表情来源、格式或正文表情协议不合法 |
| `INVALID_CURSOR` | 40007 | 分页游标无法解析或不属于当前列表 |
| `UNAUTHORIZED` | 40100 | 未认证 |
| `TOKEN_EXPIRED` | 40101 | Token 过期（access token） |
| `TOKEN_INVALID` | 40102 | Token 无效 |
| `TOKEN_REVOKED` | 40103 | Token 已被撤销（refresh token 轮转盗用检测） |
| `TOKEN_THEFT_DETECTED` | 40104 | Token 盗用检测触发，对应登录终端退出 |
| `ACCOUNT_LOCKED` | 40105 | 账号已锁定（登录失败超限） |
| `ACCOUNT_DEACTIVATED` | 40106 | 账号已注销 |
| `EMAIL_NOT_VERIFIED` | 40107 | 邮箱未验证，仅可读操作 |
| `LOGIN_FAILED` | 40110 | 登录凭据错误 |
| `CODE_EXPIRED` | 40111 | 验证码过期 |
| `CODE_INVALID` | 40112 | 验证码错误 |
| `CODE_ATTEMPTS_EXCEEDED` | 40113 | 验证码尝试次数超限 |
| `NO_CODE_RECORD` | 40114 | 缺少验证码记录（需先获取） |
| `SESSION_NOT_FOUND` | 40115 | 会话不存在 |
| `WRONG_OLD_PASSWORD` | 40116 | 旧密码错误（改密码时） |
| `FORBIDDEN` | 40300 | 通用权限不足 |
| `NOT_THREAD_OWNER` | 40301 | 非主题帖所有者 |
| `NOT_COLLABORATOR` | 40302 | 非主题帖协作者 |
| `NOT_PLAYER` | 40303 | 非帖内玩家 |
| `CANNOT_MODERATE_OWNER` | 40304 | 越权管理 OWNER |
| `DIRECT_MESSAGE_BLOCKED` | 40305 | 私聊双方存在拉黑关系 |
| `DIRECT_MESSAGE_NOT_ALLOWED` | 40306 | 当前用户不能执行该私聊操作 |
| `NOT_FOUND` | 40400 | 通用资源不存在 |
| `USER_NOT_FOUND` | 40401 | 用户不存在 |
| `THREAD_NOT_FOUND` | 40402 | 主题帖不存在 |
| `POST_NOT_FOUND` | 40403 | 楼层不存在 |
| `SUBTHREAD_NOT_FOUND` | 40404 | 子贴不存在 |
| `DRAFT_NOT_FOUND` | 40405 | 草稿不存在 |
| `TAG_NOT_FOUND` | 40406 | 标签不存在 |
| `SUBSCRIPTION_NOT_FOUND` | 40407 | 订阅不存在 |
| `INVITE_INVALID` | 40408 | 邀请链接无效或已失效 |
| `MEDIA_NOT_FOUND` | 40409 | 媒体文件不存在 |
| `REPORT_NOT_FOUND` | 40410 | 举报不存在 |
| `DIRECT_CONVERSATION_NOT_FOUND` | 40411 | 私聊会话不存在 |
| `DIRECT_MESSAGE_NOT_FOUND` | 40412 | 私聊消息不存在 |
| `STICKER_NOT_FOUND` | 40413 | 表情资产、收藏或导入记录不存在 |
| `CONFLICT` | 40900 | 通用冲突 |
| `EMAIL_ALREADY_REGISTERED` | 40901 | 邮箱已被注册 |
| `USERNAME_TAKEN` | 40902 | 用户名已被占用 |
| `ALREADY_MEMBER` | 40903 | 已是参与人 |
| `ALREADY_SUBSCRIBED` | 40904 | 已订阅 |
| `TAG_ALREADY_EXISTS` | 40905 | 标签已存在 |
| `DIRECT_MESSAGE_REQUEST_PENDING` | 40906 | 陌生消息请求仍待处理，不能继续发送 |
| `DIRECT_MESSAGE_REQUEST_DECLINED` | 40907 | 陌生消息请求已被拒绝 |
| `DIRECT_MESSAGE_RECALL_EXPIRED` | 40908 | 私聊消息已超过撤回时限 |
| `DIRECT_MESSAGE_MEDIA_ATTACHED` | 40909 | 图片已绑定到其他私聊消息 |
| `STICKER_LIMIT_REACHED` | 40910 | 表情收藏数量达到上限 |
| `STICKER_COLLECTION_VERSION_CONFLICT` | 40911 | 表情收藏夹版本冲突 |
| `IDEMPOTENCY_KEY_REUSED` | 40912 | 同一幂等键被复用于不同创建请求 |
| `RATE_LIMITED` | 42900 | 请求过于频繁 |
| `INTERNAL_ERROR` | 50000 | 服务器内部错误 |
