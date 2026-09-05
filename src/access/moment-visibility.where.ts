import { Prisma } from '@prisma/client';

import { visibleUserWhere } from './block-visibility.where';

export const visibleMomentAuthorWhere = visibleUserWhere;

/** 动态的查看者可见性条件；删除状态由各查询按场景显式约束。 */
export function momentViewerVisibility(viewerId?: string): Prisma.MomentWhereInput {
  return viewerId ? { author: visibleMomentAuthorWhere(viewerId) } : {};
}
