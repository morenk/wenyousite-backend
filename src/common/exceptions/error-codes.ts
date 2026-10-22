/** 业务错误码枚举：统一所有异常的可机器识别编码，供 Flutter 端程序化处理 */

export const ErrorCode = {
  /** 成功 */
  SUCCESS: 0,

  // ── 通用 ──
  /** 参数校验失败 */
  VALIDATION_ERROR: 40000,
  /** 通用业务逻辑错误 */
  BAD_REQUEST: 40001,
  /** 乐观锁冲突 */
  OPTIMISTIC_LOCK_CONFLICT: 40002,
  /** 骰子表达式不合法 */
  INVALID_DICE_NOTATION: 40003,
  /** 单帖骰子次数超限 */
  DICE_ROLL_LIMIT_EXCEEDED: 40004,
  /** 私聊消息正文或附件不合法 */
  INVALID_DIRECT_MESSAGE: 40005,
  /** 表情来源、格式或正文表情协议不合法 */
  INVALID_STICKER: 40006,
  /** 分页游标无法解析或不属于当前列表 */
  INVALID_CURSOR: 40007,
  /** 温油金额不是受支持的整数升 */
  INVALID_WENYOU_AMOUNT: 40008,
  /** 正文包含工具栏能力白名单之外的 Markdown 结构 */
  UNSUPPORTED_MARKDOWN_FORMAT: 40009,
  /** 定位目标可访问，但被当前作者筛选排除；客户端可清筛选重试 */
  DISCUSSION_TARGET_FILTERED: 40010,
  /** 发言身份与编辑器确认状态不一致 */
  RP_IDENTITY_CHANGED: 40011,
  /** 结构化提及标签不属于目标账号的帖内身份 */
  RP_MENTION_CHANGED: 40012,
  /** 每账号每主题的未删除 RP 身份达到十个 */
  RP_IDENTITY_LIMIT: 40013,
  /** 编辑器未声明能够保留 Markdown 6 角色提及源码 */
  MARKDOWN_CAPABILITY_REQUIRED: 40014,
  /** 角色提及新写激活开关尚未开启 */
  ROLE_MENTIONS_DISABLED: 40015,
  /** 编辑器未声明能够保留文本颜色 v1 */
  TEXT_COLOR_CAPABILITY_REQUIRED: 40016,
  /** 文本颜色新写激活开关尚未开启 */
  TEXT_COLOR_DISABLED: 40017,
  /** 文本颜色受控标记不合法 */
  INVALID_TEXT_COLOR: 40018,
  /** 编辑器未声明能够保留文本字体 v1 */
  TEXT_FONT_CAPABILITY_REQUIRED: 40019,
  /** 文本字体新写激活开关尚未开启 */
  TEXT_FONT_DISABLED: 40020,
  /** 字体受控标记或字体身份不合法 */
  INVALID_TEXT_FONT: 40021,

  // ── 认证 401xx ──
  /** 未认证 */
  UNAUTHORIZED: 40100,
  /** Token 过期（access token） */
  TOKEN_EXPIRED: 40101,
  /** Token 无效 */
  TOKEN_INVALID: 40102,
  /** Token 已被撤销（refresh token 轮转盗用检测） */
  TOKEN_REVOKED: 40103,
  /** Token 盗用检测触发，对应登录终端退出 */
  TOKEN_THEFT_DETECTED: 40104,
  /** 账号已锁定（登录失败超限） */
  ACCOUNT_LOCKED: 40105,
  /** 账号已注销 */
  ACCOUNT_DEACTIVATED: 40106,
  /** 账号处于管理员暂停期 */
  ACCOUNT_SUSPENDED: 40108,
  /** 账号已被管理员永久封禁 */
  ACCOUNT_BANNED: 40109,
  /** 登录凭据错误 */
  LOGIN_FAILED: 40110,
  /** 验证码过期 */
  CODE_EXPIRED: 40111,
  /** 验证码错误 */
  CODE_INVALID: 40112,
  /** 验证码尝试次数超限 */
  CODE_ATTEMPTS_EXCEEDED: 40113,
  /** 缺少验证码记录（需先获取） */
  NO_CODE_RECORD: 40114,
  /** 会话不存在 */
  SESSION_NOT_FOUND: 40115,
  /** 旧密码错误（改密码时） */
  WRONG_OLD_PASSWORD: 40116,
  /** 需要独立的 Web 管理会话 */
  ADMIN_SESSION_REQUIRED: 40117,
  /** 管理会话已过期或被撤销 */
  ADMIN_SESSION_EXPIRED: 40118,
  /** 管理登录或二次验证挑战无效 */
  ADMIN_CHALLENGE_INVALID: 40119,
  /** 仅限申诉接口的访问令牌无效 */
  APPEAL_TOKEN_INVALID: 40120,

  // ── 权限 403xx ──
  /** 通用权限不足 */
  FORBIDDEN: 40300,
  /** 非主题帖所有者 */
  NOT_THREAD_OWNER: 40301,
  /** 非主题帖协作者 */
  NOT_COLLABORATOR: 40302,
  /** 非帖内玩家 */
  NOT_PLAYER: 40303,
  /** 越权管理 OWNER */
  CANNOT_MODERATE_OWNER: 40304,
  /** 私聊双方存在拉黑关系 */
  DIRECT_MESSAGE_BLOCKED: 40305,
  /** 当前用户不能执行该私聊操作 */
  DIRECT_MESSAGE_NOT_ALLOWED: 40306,
  /** 自我打赏、拉黑关系或其他打赏策略拒绝 */
  TIP_NOT_ALLOWED: 40307,
  /** 需要管理员角色 */
  ADMIN_REQUIRED: 40308,
  /** 不能管理同级或更高等级管理员 */
  CANNOT_MODERATE_ADMIN: 40309,
  /** 当前管理会话需要重新验证邮箱 */
  ADMIN_STEP_UP_REQUIRED: 40310,

  // ── 资源不存在 404xx ──
  /** 通用资源不存在 */
  NOT_FOUND: 40400,
  /** 用户不存在 */
  USER_NOT_FOUND: 40401,
  /** 主题帖不存在 */
  THREAD_NOT_FOUND: 40402,
  /** 楼层不存在 */
  POST_NOT_FOUND: 40403,
  /** 子贴不存在 */
  SUBTHREAD_NOT_FOUND: 40404,
  /** 草稿不存在 */
  DRAFT_NOT_FOUND: 40405,
  /** 标签不存在 */
  TAG_NOT_FOUND: 40406,
  /** 订阅不存在 */
  SUBSCRIPTION_NOT_FOUND: 40407,
  /** 邀请链接无效或已失效 */
  INVITE_INVALID: 40408,
  /** 媒体文件不存在 */
  MEDIA_NOT_FOUND: 40409,
  /** 举报不存在 */
  REPORT_NOT_FOUND: 40410,
  /** 私聊会话不存在 */
  DIRECT_CONVERSATION_NOT_FOUND: 40411,
  /** 私聊消息不存在 */
  DIRECT_MESSAGE_NOT_FOUND: 40412,
  /** 表情资产、收藏或导入记录不存在 */
  STICKER_NOT_FOUND: 40413,
  /** 主题帖分类不存在 */
  THREAD_CATEGORY_NOT_FOUND: 40414,
  /** 动态或动态评论不存在 */
  MOMENT_NOT_FOUND: 40415,
  /** 治理案件不存在 */
  MODERATION_CASE_NOT_FOUND: 40416,
  /** 治理决定不存在 */
  MODERATION_DECISION_NOT_FOUND: 40417,
  /** 申诉不存在 */
  MODERATION_APPEAL_NOT_FOUND: 40418,
  /** 已预留媒体的对象尚未上传或直传未完成 */
  MEDIA_OBJECT_MISSING: 40419,

  // ── 冲突 409xx ──
  /** 通用冲突 */
  CONFLICT: 40900,
  /** 邮箱已被注册 */
  EMAIL_ALREADY_REGISTERED: 40901,
  /** 用户名已被占用 */
  USERNAME_TAKEN: 40902,
  /** 已是参与人 */
  ALREADY_MEMBER: 40903,
  /** 已订阅 */
  ALREADY_SUBSCRIBED: 40904,
  /** 标签已存在 */
  TAG_ALREADY_EXISTS: 40905,
  /** 陌生消息请求仍待处理，不能继续发送 */
  DIRECT_MESSAGE_REQUEST_PENDING: 40906,
  /** 陌生消息请求已被拒绝 */
  DIRECT_MESSAGE_REQUEST_DECLINED: 40907,
  /** 私聊消息已超过撤回时限 */
  DIRECT_MESSAGE_RECALL_EXPIRED: 40908,
  /** 图片已绑定到其他私聊消息 */
  DIRECT_MESSAGE_MEDIA_ATTACHED: 40909,
  /** 表情收藏数量达到上限 */
  STICKER_LIMIT_REACHED: 40910,
  /** 表情收藏夹版本冲突 */
  STICKER_COLLECTION_VERSION_CONFLICT: 40911,
  /** 同一幂等键被复用于不同创建请求 */
  IDEMPOTENCY_KEY_REUSED: 40912,
  /** 温油钱包余额不足 */
  INSUFFICIENT_WENYOU: 40913,
  /** 同一用户已对同一目标提交待处理举报 */
  REPORT_ALREADY_PENDING: 40914,
  /** 举报已经结案 */
  REPORT_ALREADY_HANDLED: 40915,
  /** 内容当前状态不允许执行隐藏或恢复 */
  CONTENT_STATE_CONFLICT: 40916,
  /** 账号处罚当前状态冲突 */
  SANCTION_STATE_CONFLICT: 40917,
  /** 主题帖分类标识或名称已存在 */
  THREAD_CATEGORY_ALREADY_EXISTS: 40918,
  /** 分类或标签已停用，不能用于新内容 */
  TAXONOMY_STATE_CONFLICT: 40919,
  /** 治理案件已被其他管理员结案 */
  MODERATION_CASE_ALREADY_CLOSED: 40920,
  /** 同一治理决定已经提交申诉 */
  APPEAL_ALREADY_SUBMITTED: 40921,
  /** 治理决定已超过申诉期限 */
  APPEAL_WINDOW_CLOSED: 40922,
  /** 管理员邀请已存在或已经处理 */
  ADMIN_INVITE_CONFLICT: 40923,
  /** 图片历史位置索引尚未回填完成 */
  IMAGE_GALLERY_NOT_READY: 40926,
  /** 注册被站务临时暂停 */
  REGISTRATION_PAUSED: 40924,
  /** 用户内容写入被站务临时暂停 */
  CONTENT_WRITES_PAUSED: 40925,

  /** 字体目录分页快照已变化，需从第一页重取 */
  TEXT_FONT_CATALOG_CHANGED: 40927,
  /** 字体管理修订或当前状态冲突 */
  TEXT_FONT_STATE_CONFLICT: 40928,
  /** 字体授权材料尚未完整确认 */
  TEXT_FONT_RIGHTS_REQUIRED: 40929,
  /** 字体版本已撤回，禁止下载与呈现 */
  TEXT_FONT_WITHDRAWN: 41001,
  /** 动态字体服务或隔离处理依赖未就绪 */
  TEXT_FONT_UNAVAILABLE: 50301,

  // ── 限流 429xx ──
  /** 请求过于频繁 */
  RATE_LIMITED: 42900,
  /** 音频活动上传/处理中名额已满，可保留 mediaId 稍后恢复 */
  AUDIO_ACTIVE_LIMIT: 42901,
  /** UTC 当日新音频签发输入预留达到上限 */
  AUDIO_DAILY_BYTES_LIMIT: 42902,

  // ── 服务端 500xx ──
  /** 服务器内部错误 */
  INTERNAL_ERROR: 50000,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 根据 HTTP 状态码映射默认业务错误码 */
export function httpStatusToCode(status: number): number {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 500:
      return ErrorCode.INTERNAL_ERROR;
    default:
      return status;
  }
}
