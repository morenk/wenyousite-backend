import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { ThreadCategoriesService } from './thread-categories.service';

describe('ThreadCategoriesService', () => {
  const prisma = {
    threadCategoryDefinition: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  const cache = {
    buildKey: jest.fn((...parts: string[]) => parts.join(':')),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  let service: ThreadCategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    service = new ThreadCategoriesService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );
  });

  it('只返回启用分类并缓存有序结果', async () => {
    const categories = [{ id: 'c1', slug: 'RPG', name: '角色扮演', isActive: true }];
    prisma.threadCategoryDefinition.findMany.mockResolvedValue(categories);

    await expect(service.listActive()).resolves.toEqual(categories);
    expect(prisma.threadCategoryDefinition.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    expect(cache.set).toHaveBeenCalledWith('thread-categories:active', categories, 300_000);
  });

  it('规范化并接受启用分类', async () => {
    prisma.threadCategoryDefinition.findUnique.mockResolvedValue({
      slug: 'MYSTERY',
      isActive: true,
    });

    await expect(service.assertSelectable(' mystery ')).resolves.toBe('MYSTERY');
    expect(prisma.threadCategoryDefinition.findUnique).toHaveBeenCalledWith({
      where: { slug: 'MYSTERY' },
      select: { slug: true, isActive: true },
    });
  });

  it('拒绝不存在或已停用的分类', async () => {
    prisma.threadCategoryDefinition.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      slug: 'ARCHIVE',
      isActive: false,
    });

    await expect(service.assertSelectable('UNKNOWN')).rejects.toMatchObject({
      errorCode: ErrorCode.THREAD_CATEGORY_NOT_FOUND,
    });
    await expect(service.assertSelectable('ARCHIVE')).rejects.toMatchObject({
      errorCode: ErrorCode.TAXONOMY_STATE_CONFLICT,
    });
  });
});
