import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  thread: { findMany: jest.fn() },
  post: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  threadMember: { groupBy: jest.fn() },
  $queryRaw: jest.fn(),
};

const postDetail = (id: string) => ({
  id,
  floorNumber: 1,
  content: `内容 ${id}`,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  author: { id: 'u1', username: '测试用户' },
  thread: { id: `thread-${id}`, title: `主题 ${id}` },
  subthread: { id: 's1', title: '主讨论区' },
});

function lastRawSql(): string {
  const query = mockPrisma.$queryRaw.mock.calls.at(-1)?.[0] as { strings?: string[] };
  return query?.strings?.join(' ') ?? '';
}

function lastRawValues(): unknown[] {
  const query = mockPrisma.$queryRaw.mock.calls.at(-1)?.[0] as { values?: unknown[] };
  return query?.values ?? [];
}

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
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.thread.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.threadMember.groupBy.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  it('空关键词应返回兼容空结果', async () => {
    await expect(service.search('')).resolves.toEqual({
      users: [],
      threads: [],
      posts: [],
    });
  });

  it('用户分类只查询未注销用户且不返回敏感字段', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', username: '测试用户', avatar: null, bio: null },
    ]);

    const users = await service.searchUsers('测试');

    expect(users).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        username: { contains: '测试', mode: 'insensitive' },
      },
      select: { id: true, username: true, avatar: true, bio: true },
      take: 20,
      orderBy: { username: 'asc' },
    });
    expect(mockPrisma.thread.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('主题帖分类只查询公开已发布主题并合并玩家计数', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([
      { id: 't1', title: '测试帖', _count: { members: 5, posts: 3 } },
    ]);
    mockPrisma.threadMember.groupBy.mockResolvedValue([
      { threadId: 't1', _count: 2 },
    ]);

    const threads = await service.searchThreads('测试');

    expect(threads[0]._count).toEqual({ members: 5, posts: 3, players: 2 });
    expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          published: true,
          visibility: 'PUBLIC',
          title: { contains: '测试', mode: 'insensitive' },
        },
      }),
    );
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('楼层正文不足两个有效字符时拒绝查询数据库', async () => {
    await expect(service.searchPosts('字')).rejects.toThrow(BadRequestException);
    await expect(service.searchPosts(' a ')).rejects.toThrow('楼层内容搜索至少需要 2 个字符');
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  it('楼层正文按相关度游标分页，每页 20 条且每个主题最多 3 条', async () => {
    const rankedRows = Array.from({ length: 21 }, (_, index) => ({
      id: `p${index + 1}`,
      relevance: 1 - index / 100,
      createdAt: new Date(`2026-08-01T00:${String(index).padStart(2, '0')}:00.000Z`),
    }));
    mockPrisma.$queryRaw.mockResolvedValue(rankedRows);
    mockPrisma.post.findMany.mockResolvedValue(
      rankedRows.slice(0, 20).reverse().map((row) => postDetail(row.id)),
    );

    const page = await service.searchPosts('测试');

    expect(page.items).toHaveLength(20);
    expect(page.items[0].id).toBe('p1');
    expect(page.items[19].id).toBe('p20');
    expect(page.pagination).toEqual({
      cursor: expect.any(String),
      hasMore: true,
    });
    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: rankedRows.slice(0, 20).map((row) => row.id) } },
      }),
    );

    const sql = lastRawSql();
    expect(sql).toContain('similarity');
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('"threadRank" <=');
    expect(lastRawValues()).toContain(3);
    expect(sql).toContain('p."kind" = \'FLOOR\'');
    expect(sql).toContain('t."visibility" = \'PUBLIC\'');
    expect(sql).toContain('s."deleted_at" IS NULL');
  });

  it('下一页游标应参与相关度、时间和 ID 的稳定排序条件', async () => {
    const firstRow = {
      id: 'p1',
      relevance: 0.75,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    mockPrisma.$queryRaw.mockResolvedValue([firstRow]);
    mockPrisma.post.findMany.mockResolvedValue([postDetail('p1')]);
    const firstPage = await service.searchPosts('测试');

    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.searchPosts('测试', firstPage.pagination.cursor ?? undefined);

    const sql = lastRawSql();
    expect(sql).toContain('ranked.relevance <');
    expect(sql).toContain('ranked."createdAt" <');
    expect(sql).toContain('ranked.id <');
  });

  it('非法楼层搜索游标应返回 400', async () => {
    await expect(service.searchPosts('测试', 'not-a-cursor')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('兼容搜索在单字符时仅返回用户和主题帖，不执行楼层扫描', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    mockPrisma.thread.findMany.mockResolvedValue([{ id: 't1', _count: {} }]);

    const result = await service.search('字');

    expect(result.users).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(result.posts).toEqual([]);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });
});
