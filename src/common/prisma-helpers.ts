/** Prisma 查询辅助：消除软删除过滤、子贴/楼层计数等重复模式 */

/** 展开到 where 子句，过滤已软删除记录 */
export const notDeleted = { deletedAt: null } as const;

/** 子贴查询中内联的楼层计数（排除已删楼层） */
export const countNonDeletedPosts = () => ({
  _count: { select: { posts: { where: notDeleted } } },
});

/** 子贴查询中内联的楼中楼计数（排除已删回复） */
export const countNonDeletedReplies = () => ({
  _count: { select: { replies: { where: notDeleted } } },
});

/** 主题帖 include: 非删子贴列表，按 sortOrder 升序，含楼层计数、标签与首楼正文回填 */
export const includeSubthreads = (select?: Record<string, boolean>) => ({
  subthreads: {
    where: notDeleted,
    orderBy: { sortOrder: 'asc' as const },
    include: {
      ...countNonDeletedPosts(),
      tags: { include: { tag: true } },
      bodyPost: { select: { id: true, content: true, version: true } },
      ...(select ? { select } : {}),
    },
  },
});

/** 帖子 include: 作者基本信息 */
export const authorSelect = {
  id: true, username: true, avatar: true,
} as const;

/** 计数用户和帖子总数 */
export const countMembersAndPosts = () => ({
  _count: { select: { members: true, posts: true } },
});

/** 批量补全 _count.players：统计各主题帖 playerMarked=true（被授予玩家身份）的参与人数。
 *  Prisma 的 _count 输出键名只能跟关系名（members），无法直接别名 players，故单独 groupBy 后合并 */
export async function attachPlayerCounts(
  prisma: { threadMember: { groupBy: (args: any) => Promise<{ threadId: string; _count: number }[]> } },
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
