import { mapThreadCategoryInfo, withThreadCategoryInfo } from './thread-category-info';

describe('thread category display read model', () => {
  it('uses the current registry name even when the category is inactive', () => {
    expect(
      mapThreadCategoryInfo('RPG', {
        slug: 'RPG',
        name: '角色扮演',
        isActive: false,
      }),
    ).toEqual({ slug: 'RPG', name: '角色扮演', isActive: false });
  });

  it('preserves unknown historical slugs with a safe inactive fallback', () => {
    expect(mapThreadCategoryInfo('LEGACY', null)).toEqual({
      slug: 'LEGACY',
      name: 'LEGACY',
      isActive: false,
    });
  });

  it('returns null for uncategorized records and never leaks the Prisma relation', () => {
    expect(
      withThreadCategoryInfo({
        id: 'thread-1',
        category: null,
        categoryDefinition: null,
      }),
    ).toEqual({ id: 'thread-1', category: null, categoryInfo: null });
  });
});
