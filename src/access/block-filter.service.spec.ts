import { PrismaService } from '../prisma/prisma.service';
import { BlockFilterService } from './block-filter.service';

describe('BlockFilterService', () => {
  const prisma = {
    userBlock: { findMany: jest.fn() },
  };
  let service: BlockFilterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlockFilterService(prisma as unknown as PrismaService);
  });

  it('一次加载双向拉黑关系并转换为集合', async () => {
    prisma.userBlock.findMany
      .mockResolvedValueOnce([{ blockerId: 'blocked-by-1' }, { blockerId: 'blocked-by-2' }])
      .mockResolvedValueOnce([{ blockedId: 'blocked-1' }]);

    await expect(service.loadBlockSets('author')).resolves.toEqual({
      blockedByUser: new Set(['blocked-by-1', 'blocked-by-2']),
      blockedByAuthor: new Set(['blocked-1']),
    });
    expect(prisma.userBlock.findMany).toHaveBeenNthCalledWith(1, {
      where: { blockedId: 'author' },
      select: { blockerId: true },
    });
    expect(prisma.userBlock.findMany).toHaveBeenNthCalledWith(2, {
      where: { blockerId: 'author' },
      select: { blockedId: true },
    });
  });

  it('同时排除拉黑作者和被作者拉黑的接收者并保持原顺序', () => {
    expect(service.filterRecipients(
      ['allowed-1', 'blocked-by', 'blocked', 'allowed-2', 'allowed-1'],
      {
        blockedByUser: new Set(['blocked-by']),
        blockedByAuthor: new Set(['blocked']),
      },
    )).toEqual(['allowed-1', 'allowed-2', 'allowed-1']);
  });
});
