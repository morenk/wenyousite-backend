import { Prisma } from '@prisma/client';
import { notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** 主题与帖子治理共享 Thread 聚合锁，避免隐藏与新回复交错提交。 */
export async function lockModeratedThreadAggregate(
  tx: Prisma.TransactionClient,
  targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
  targetId: string,
): Promise<void> {
  if (targetType === 'THREAD') {
    await tx.$queryRaw`SELECT "id" FROM "threads" WHERE "id" = ${targetId} FOR UPDATE`;
    return;
  }
  if (targetType !== 'POST') return;

  const post = await tx.post.findUnique({ where: { id: targetId }, select: { threadId: true } });
  if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '公开帖子不存在');
  await tx.$queryRaw`SELECT "id" FROM "threads" WHERE "id" = ${post.threadId} FOR UPDATE`;
}
