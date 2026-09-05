import type { Prisma } from '@prisma/client';
import { visibleThreadOwnerWhere } from './block-visibility.where';

/**
 * Database-level visibility filter for published thread collections.
 *
 * Keeping this as a pure query builder prevents list endpoints from drifting
 * away from ThreadAccessService's point-lookup policy.
 */
export function publishedThreadVisibilityWhere(viewerId?: string): Prisma.ThreadWhereInput {
  if (!viewerId) {
    return {
      deletedAt: null,
      published: true,
      visibility: 'PUBLIC',
    };
  }

  return {
    deletedAt: null,
    published: true,
    ...visibleThreadOwnerWhere(viewerId),
    OR: [
      { visibility: 'PUBLIC' },
      {
        visibility: 'PRIVATE',
        members: { some: { userId: viewerId } },
      },
    ],
  };
}
