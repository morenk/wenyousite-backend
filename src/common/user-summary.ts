/** 已注销用户的公共展示规则：内部墓碑字段不得泄露到 API 用户摘要。 */

export const DEACTIVATED_USER_NAME = '已注销用户';

/** 面向客户端的用户摘要查询必须携带 deletedAt，供统一响应层判断是否需要匿名化。 */
export const publicUserSummarySelect = {
  id: true,
  username: true,
  avatar: true,
  deletedAt: true,
} as const;

type JsonRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUserSummary(value: JsonRecord): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'deletedAt') &&
    !Object.prototype.hasOwnProperty.call(value, 'email')
  );
}

/**
 * 递归匿名化 API 中的用户摘要。通知的 fromUser.deletedAt 是既有跳转契约，需继续保留；
 * 其他摘要只输出稳定展示名和空头像，不公开注销时间。
 */
export function sanitizePublicUserSummaries<T>(value: T, fieldName?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicUserSummaries(item)) as T;
  }
  if (!isPlainRecord(value)) return value;

  const sanitized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sanitizePublicUserSummaries(item, key),
    ]),
  ) as JsonRecord;

  if (!isUserSummary(sanitized)) return sanitized as T;

  const { deletedAt, ...publicFields } = sanitized;
  const keepDeletedAt = fieldName === 'fromUser';
  if (!deletedAt) {
    return {
      ...publicFields,
      ...(keepDeletedAt ? { deletedAt: null } : {}),
    } as T;
  }

  return {
    ...publicFields,
    username: DEACTIVATED_USER_NAME,
    ...(Object.prototype.hasOwnProperty.call(sanitized, 'avatar')
      ? { avatar: null }
      : {}),
    ...(keepDeletedAt ? { deletedAt } : {}),
  } as T;
}
