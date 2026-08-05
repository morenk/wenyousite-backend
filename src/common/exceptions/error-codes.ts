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
  /** 邮箱未验证，仅可读操作 */
  EMAIL_NOT_VERIFIED: 40107,
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

  // ── 限流 429xx ──
  /** 请求过于频繁 */
  RATE_LIMITED: 42900,

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
