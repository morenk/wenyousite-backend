import { Prisma } from '@prisma/client';

/** 有效补转租约及未稳定的上传墓碑不得被 Media 级联删除；失败删除保持可重试。 */
export function mediaDisplayCleanupProtection(now = Date.now()): Prisma.MediaWhereInput {
  return { AND: [
    { OR: [{ displayStatus: null }, { displayStatus: { not: 'PROCESSING' } },
      { displayStartedAt: null }, { displayStartedAt: { lt: new Date(now - 5 * 60_000) } }] },
    { previewAttempts: { none: { status: { in: ['PENDING', 'CLEANING'] }, OR: [
      { cleanupPasses: 0 }, { expiresAt: { gt: new Date(now - 7 * 24 * 3600000) } },
    ] } } },
  ] };
}
