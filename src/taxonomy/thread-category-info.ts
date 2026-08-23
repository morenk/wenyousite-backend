import { Prisma } from '@prisma/client';
import type { ThreadCategoryInfoDto } from './dto/thread-category-info.dto';

export const threadCategoryInfoSelect = {
  slug: true,
  name: true,
  isActive: true,
} satisfies Prisma.ThreadCategoryDefinitionSelect;

type ThreadCategoryDefinitionInfo = Prisma.ThreadCategoryDefinitionGetPayload<{
  select: typeof threadCategoryInfoSelect;
}>;

export function mapThreadCategoryInfo(
  slug: string | null | undefined,
  definition: ThreadCategoryDefinitionInfo | null | undefined,
): ThreadCategoryInfoDto | null {
  if (!slug) return null;
  return {
    slug,
    name: definition?.name ?? slug,
    isActive: definition?.isActive ?? false,
  };
}

export function withThreadCategoryInfo<
  T extends {
    category: string | null;
    categoryDefinition?: ThreadCategoryDefinitionInfo | null;
  },
>(thread: T): Omit<T, 'categoryDefinition'> & { categoryInfo: ThreadCategoryInfoDto | null } {
  const { categoryDefinition, ...value } = thread;
  return {
    ...value,
    categoryInfo: mapThreadCategoryInfo(thread.category, categoryDefinition),
  };
}
