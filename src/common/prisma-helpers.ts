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

/** 主题帖 include: 非删子贴列表，按 sortOrder 升序，含楼层计数和标签 */
export const includeSubthreads = (select?: Record<string, boolean>) => ({
  subthreads: {
    where: notDeleted,
    orderBy: { sortOrder: 'asc' as const },
    include: { ...countNonDeletedPosts(), tags: { include: { tag: true } }, ...(select ? { select } : {}) },
  },
});

/** 帖子 include: 作者基本信息 */
export const authorSelect = {
  id: true, username: true, nickname: true, avatar: true,
} as const;

/** 计数用户和帖子总数 */
export const countMembersAndPosts = () => ({
  _count: { select: { members: true, posts: true } },
});
