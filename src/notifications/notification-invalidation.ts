import { Prisma } from '@prisma/client';

export type HiddenNotificationTarget = 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT';

/** 内容被隐藏时同步消除相关历史通知的未读状态；记录本身保留。 */
export async function markNotificationsReadForHiddenContent(
  tx: Prisma.TransactionClient,
  targetType: HiddenNotificationTarget,
  targetId: string,
): Promise<void> {
  const where: Prisma.NotificationWhereInput =
    targetType === 'THREAD'
      ? { threadId: targetId }
      : targetType === 'POST'
        ? { OR: [{ postId: targetId }, { post: { parentPostId: targetId } }] }
        : targetType === 'MOMENT'
          ? { momentId: targetId }
          : {
              OR: [{ momentCommentId: targetId }, { momentComment: { parentCommentId: targetId } }],
            };

  await tx.notification.updateMany({
    where: { ...where, isRead: false },
    data: { isRead: true },
  });
}
