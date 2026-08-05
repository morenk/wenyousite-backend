/** Prisma 查询辅助：消除软删除过滤、子贴/楼层计数等重复模式 */

/** 展开到 where 子句，过滤已软删除记录 */
export const notDeleted = { deletedAt: null } as const;

/** 子贴查询中内联的楼层计数（排除已删楼层；正文 kind=BODY 不占楼层号，不计入） */
export const countNonDeletedPosts = () => ({
  _count: { select: { posts: { where: { ...notDeleted, kind: 'FLOOR' as const } } } },
});

/** 子贴查询中内联的楼中楼计数（排除已删回复） */
export const countNonDeletedReplies = () => ({
  _count: { select: { replies: { where: notDeleted } } },
});

/** 骰子结果始终按帖子内稳定序号返回。 */
export const includeDiceRolls = () => ({
  diceRolls: { orderBy: { sequence: 'asc' as const } },
});

/** 主题帖 include: 非删子贴列表，按 sortOrder 升序，含楼层计数、标签与正文（kind=BODY）回填 */
export const includeSubthreads = (select?: Record<string, boolean>) => ({
  subthreads: {
    where: notDeleted,
    orderBy: { sortOrder: 'asc' as const },
    include: {
      ...countNonDeletedPosts(),
      tags: { include: { tag: true } },
      posts: {
        where: { kind: 'BODY' as const, ...notDeleted },
        take: 1,
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          content: true,
          version: true,
          pendingDiceNotations: true,
          diceRolls: { orderBy: { sequence: 'asc' as const } },
        },
      },
      ...(select ? { select } : {}),
    },
  },
});

/** 把 includeSubthreads 返回的 posts[0]（kind=BODY）映射回响应字段 bodyPost，保持 API 契约不变 */
export function mapSubthreadBody<T extends { posts?: unknown[] | null }>(subthreads: T[]) {
  return subthreads.map((s) => {
    const { posts, ...rest } = s as any;
    return { ...rest, bodyPost: posts?.[0] ?? null };
  });
}

/** 帖子 include: 作者基本信息 */
export const authorSelect = {
  id: true,
  username: true,
  avatar: true,
} as const;

/** 计数用户和帖子总数（帖子只计楼层，正文不占楼层号） */
export const countMembersAndPosts = () => ({
  _count: { select: { members: true, posts: { where: { kind: 'FLOOR' as const } } } },
});

/** 批量补全 _count.players：统计各主题帖 playerMarked=true（被授予玩家身份）的参与人数。
 *  Prisma 的 _count 输出键名只能跟关系名（members），无法直接别名 players，故单独 groupBy 后合并 */
export async function attachPlayerCounts(
  prisma: {
    threadMember: { groupBy: (args: any) => Promise<{ threadId: string; _count: number }[]> };
  },
  threads: { id: string; _count?: Record<string, number> }[],
) {
  const ids = threads.map((t) => t.id);
  if (ids.length === 0) return;
  const rows = await prisma.threadMember.groupBy({
    by: ['threadId'],
    where: { threadId: { in: ids }, playerMarked: true },
    _count: true,
  });
  const countMap = new Map(rows.map((r) => [r.threadId, r._count]));
  for (const thread of threads) {
    thread._count = { ...(thread._count ?? {}), players: countMap.get(thread.id) ?? 0 };
  }
}
