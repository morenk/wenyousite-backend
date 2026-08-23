import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadCategoriesService } from './thread-categories.service';

describe('ThreadCategoriesService', () => {
  const prisma = {
    threadCategoryDefinition: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  let service: ThreadCategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ThreadCategoriesService(prisma as unknown as PrismaService);
  });

  it('每次从事实源返回启用分类并按 sortOrder、slug 稳定排序', async () => {
    const categories = [{ id: 'c1', slug: 'RPG', name: '角色扮演', isActive: true }];
    prisma.threadCategoryDefinition.findMany.mockResolvedValue(categories);

    await expect(service.listActive()).resolves.toEqual(categories);
    expect(prisma.threadCategoryDefinition.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
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
