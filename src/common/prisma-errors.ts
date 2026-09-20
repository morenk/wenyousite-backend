/** Prisma 错误码识别统一入口；兼容真实错误与测试中的结构化替身。 */
export function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code,
  );
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2002');
}

export function isRecordNotFound(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2025');
}

/** PostgreSQL 已回滚的并发事务冲突；其他原始 SQL 错误不得按冲突吞掉。 */
export function isTransactionConflict(error: unknown): boolean {
  if (hasPrismaErrorCode(error, 'P2034')) return true;
  if (!hasPrismaErrorCode(error, 'P2010')) return false;
  const code = (error as { meta?: { code?: unknown } }).meta?.code;
  return code === '40001' || code === '40P01';
}
