import { Prisma } from '@prisma/client';

/** 当前查看者与动态作者之间不存在任一方向的拉黑关系。 */
export function visibleMomentAuthorWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    userBlocks: { none: { blockedId: viewerId } },
    blockedBy: { none: { blockerId: viewerId } },
  };
}

/** 动态的查看者可见性条件；删除状态由各查询按场景显式约束。 */
export function momentViewerVisibility(viewerId?: string): Prisma.MomentWhereInput {
  return viewerId ? { author: visibleMomentAuthorWhere(viewerId) } : {};
}
