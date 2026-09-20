import { Prisma } from '@prisma/client';

/** 后台检索只允许公开已发布内容和管理员隐藏项；计数、列表、详情共用。 */
export const adminRetainedWhere = {
  OR: [{ deletedAt: null }, { deletedAt: { not: null }, removalSource: 'ADMIN' as const }],
};
export const adminThreadWhere: Prisma.ThreadWhereInput = {
  AND: [adminRetainedWhere, { published: true, visibility: 'PUBLIC' }],
};
export const adminPostWhere: Prisma.PostWhereInput = {
  AND: [
    adminRetainedWhere,
    { kind: 'FLOOR', thread: adminThreadWhere, subthread: { deletedAt: null } },
    { OR: [{ parentPostId: null }, { parentPost: adminRetainedWhere }] },
  ],
};
export const adminMomentWhere: Prisma.MomentWhereInput = adminRetainedWhere;
export const adminCommentWhere: Prisma.MomentCommentWhereInput = {
  AND: [
    adminRetainedWhere,
    { moment: adminMomentWhere },
    { OR: [{ parentCommentId: null }, { parentComment: adminRetainedWhere }] },
  ],
};
