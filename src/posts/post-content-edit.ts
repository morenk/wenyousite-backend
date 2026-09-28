import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { Prisma } from '@prisma/client';

/** 各正文编辑入口共用；系统状态变化不经过此函数。 */
export function postContentEditData(previousContent: string, content: string): Prisma.PostUpdateInput {
  return {
    content,
    version: { increment: 1 },
    ...(content !== previousContent ? { editedAt: new Date() } : {}),
  };
}

export function rethrowPostEditConflict(error: unknown, message: string): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
    throw new BusinessException(ErrorCode.OPTIMISTIC_LOCK_CONFLICT, message, HttpStatus.CONFLICT);
  }
  throw error;
}
