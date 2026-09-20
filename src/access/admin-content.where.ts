import { Prisma } from '@prisma/client';

/** 后台检索只允许公开已发布内容和管理员隐藏项；计数、列表、详情共用。 */
export const adminRetainedWhere = {
  OR: [{ deletedAt: null }, { deletedAt: { not: null }, removalSource: 'ADMIN' as const }],
};
export const adminThreadWhere: Prisma.ThreadWhereInput = {
  AND: [adminRetainedWhere, { published: true, visibility: 'PUBLIC' }],
};
export const adminPostDetailWhere: Prisma.PostWhereInput = {
  AND: [
    adminRetainedWhere,
    { thread: adminThreadWhere, subthread: { deletedAt: null } },
    { OR: [{ parentPostId: null }, { parentPost: adminRetainedWhere }] },
  ],
};
export const adminPostWhere: Prisma.PostWhereInput = {
  AND: [adminPostDetailWhere, { kind: 'FLOOR' }],
};
export const adminMomentWhere: Prisma.MomentWhereInput = adminRetainedWhere;
export const adminCommentWhere: Prisma.MomentCommentWhereInput = {
  AND: [
    adminRetainedWhere,
    { moment: adminMomentWhere },
    { OR: [{ parentCommentId: null }, { parentComment: adminRetainedWhere }] },
  ],
};

/** 隐藏/恢复命令需要父级当前公开可见，不能仅依赖查询返回的按钮状态。 */
export function adminPostParentsVisible(post: {
  thread: { published: boolean; visibility: string; deletedAt: Date | null };
  subthread: { deletedAt: Date | null };
  parentPost?: { deletedAt: Date | null } | null;
}) {
  return (
    post.thread.published &&
    post.thread.visibility === 'PUBLIC' &&
    !post.thread.deletedAt &&
    !post.subthread.deletedAt &&
    !post.parentPost?.deletedAt
  );
}
