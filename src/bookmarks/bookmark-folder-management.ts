import { Prisma } from '@prisma/client';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export function normalizeFolderName(rawName: string): string {
  const name = rawName.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 24) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '收藏夹名称须为 1–24 个字符');
  }
  return name;
}

export function assertCustomFolder(
  folder: { isDefault: boolean } | null,
): asserts folder is { isDefault: boolean } {
  if (!folder) throw notFound(ErrorCode.NOT_FOUND, '收藏夹不存在');
  if (folder.isDefault) {
    throw new BusinessException(ErrorCode.CONFLICT, '默认收藏夹不可重命名或删除', 409);
  }
}

export function rethrowFolderWriteError(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code === 'P2002') {
    throw new BusinessException(ErrorCode.CONFLICT, '已存在同名收藏夹，请刷新后重试', 409);
  }
  // PostgreSQL 的 RESTRICT (23001) 在当前 Prisma 引擎中可能未映射成 P2003。
  const restrictConflict =
    error instanceof Prisma.PrismaClientUnknownRequestError && /code: "23001"/.test(error.message);
  if (restrictConflict || (code && ['P2003', 'P2014', 'P2025', 'P2034'].includes(code))) {
    throw new BusinessException(ErrorCode.CONFLICT, '收藏夹发生并发变更，请刷新后重试', 409);
  }
  throw error;
}
