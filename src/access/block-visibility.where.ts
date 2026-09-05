import { Prisma } from '@prisma/client';
import { forbidden } from '../common/exceptions/business.exception';

/** 同一查看者的双向拉黑条件；在数据库分页和聚合之前应用。 */
export function visibleUserWhere(viewerId?: string) {
  return viewerId ? {
    userBlocks: { none: { blockedId: viewerId } },
    blockedBy: { none: { blockerId: viewerId } },
  } : {};
}

export function visibleThreadOwnerWhere(viewerId?: string) {
  return viewerId ? { owner: visibleUserWhere(viewerId) } : {};
}

/** 集合与详情共享的主题可见性，包含仅楼主可读的未发布草稿。 */
export function accessibleThreadWhere(viewerId?: string): Prisma.ThreadWhereInput {
  return { deletedAt: null, ...visibleThreadOwnerWhere(viewerId), OR: [
    { published: true, visibility: 'PUBLIC' },
    ...(viewerId ? [
      { published: true, visibility: 'PRIVATE' as const, members: { some: { userId: viewerId } } },
      { published: false, ownerId: viewerId },
    ] : []),
  ] };
}

export function visiblePostWhere(viewerId?: string) {
  return {
    deletedAt: null,
    subthread: { deletedAt: null },
    ...(viewerId ? { author: visibleUserWhere(viewerId) } : {}),
    OR: [{ parentPostId: null }, {
      parentPost: { deletedAt: null, ...(viewerId ? { author: visibleUserWhere(viewerId) } : {}) },
    }],
  };
}

/** userIdColumn 只能由服务内固定 SQL 列引用提供，不接受请求文本。 */
export function unblockedUserSql(viewerId: string | undefined, userIdColumn: Prisma.Sql): Prisma.Sql {
  return viewerId ? Prisma.sql`AND NOT EXISTS (
    SELECT 1 FROM user_blocks blocked
    WHERE (blocked.blocker_id = ${viewerId} AND blocked.blocked_id = ${userIdColumn})
       OR (blocked.blocked_id = ${viewerId} AND blocked.blocker_id = ${userIdColumn})
  )` : Prisma.empty;
}

/** 写入与拉黑共用有序的用户行锁；调用者须在获取内容或会话锁之前调用。 */
export async function lockInteractionUsers(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
}

export async function assertInteractionAllowed(tx: Prisma.TransactionClient, actorId: string, targetIds: string[]) {
  const targets = [...new Set(targetIds)].filter((id) => id !== actorId);
  await lockInteractionUsers(tx, [actorId, ...targets]);
  if (!targets.length) return;
  const blocked = await tx.userBlock.findFirst({
    where: { OR: [
      { blockerId: actorId, blockedId: { in: targets } },
      { blockedId: actorId, blockerId: { in: targets } },
    ] }, select: { id: true },
  });
  if (blocked) throw forbidden('双方存在拉黑关系，无法互动');
}
