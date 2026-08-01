import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  thread: { findMany: jest.fn() },
  post: { findMany: jest.fn() },
  threadMember: { groupBy: jest.fn().mockResolvedValue([]) },
};

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SearchService>(SearchService);
    jest.clearAllMocks();
  });

  it('空关键词应返回空结果', async () => {
    const result = await service.search('');
    expect(result).toEqual({ threads: [], posts: [] });
  });

  it('应搜索公开帖标题和楼层内容', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([{ id: 't1', title: '测试帖' }]);
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', content: '测试内容' }]);

    const result = await service.search('测试');
    expect(result.threads).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
    expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          published: true,
          visibility: 'PUBLIC',
        }),
      }),
    );
    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          thread: { published: true, visibility: 'PUBLIC', deletedAt: null },
        }),
      }),
    );
  });

  it('帖子搜索应排除私密帖的帖子', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([]);

    await service.search('关键词');

    // 验证 post 查询包含私密帖过滤条件
    const call = mockPrisma.post.findMany.mock.calls[0][0];
    expect(call.where.thread).toEqual({ published: true, visibility: 'PUBLIC', deletedAt: null });
  });

  it('搜索结果合并玩家计数 _count.players', async () => {
    const threads = [{ id: 't1', title: '测试帖', _count: { members: 5, posts: 3 } as any }];
    mockPrisma.thread.findMany.mockResolvedValue(threads);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 2 }]);

    const result = await service.search('测试');
    expect((result.threads[0]._count as any).players).toBe(2);
    expect((result.threads[0]._count as any).members).toBe(5);
    expect(mockPrisma.threadMember.groupBy).toHaveBeenCalledWith({
      by: ['threadId'],
      where: { threadId: { in: ['t1'] }, playerMarked: true },
      _count: true,
    });
  });
});
