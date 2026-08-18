import { Prisma } from '@prisma/client';
import { momentAuthorSelect, momentMediaSelect } from './moment.mapper';

export function visibleMomentAuthorWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    userBlocks: { none: { blockedId: viewerId } },
    blockedBy: { none: { blockerId: viewerId } },
  };
}

export function momentViewerVisibility(viewerId?: string): Prisma.MomentWhereInput {
  return viewerId ? { author: visibleMomentAuthorWhere(viewerId) } : {};
}

export function momentCardSelect(viewerId?: string): Prisma.MomentSelect {
  return {
    id: true,
    authorId: true,
    author: { select: momentAuthorSelect },
    title: true,
    content: true,
    textCoverTheme: true,
    coverMedia: { select: momentMediaSelect },
    likeCount: true,
    commentCount: true,
    bookmarkCount: true,
    tipTotal: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    likes: { where: { userId: viewerId ?? '__anonymous__' }, take: 1, select: { id: true } },
    bookmarks: { where: { userId: viewerId ?? '__anonymous__' }, take: 1, select: { id: true } },
    _count: { select: { images: true } },
  };
}

export function momentDetailSelect(viewerId?: string): Prisma.MomentSelect {
  return {
    ...momentCardSelect(viewerId),
    images: {
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true, media: { select: momentMediaSelect } },
    },
  };
}
