import type { Prisma } from '@prisma/client';

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
    OR: [
      { visibility: 'PUBLIC' },
      {
        visibility: 'PRIVATE',
        members: { some: { userId: viewerId } },
      },
    ],
  };
}
