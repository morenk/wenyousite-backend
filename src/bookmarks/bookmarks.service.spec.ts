import { Test, TestingModule } from '@nestjs/testing';
import { BookmarksService } from './bookmarks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  userBookmark: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  thread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn() },
};

describe('BookmarksService', () => {
  let service: BookmarksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookmarksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<BookmarksService>(BookmarksService);
    jest.clearAllMocks();
  });

  it('findAll 返回值附带 bookmarkId（供取消收藏）', async () => {
    const bookmark = {
      id: 'bm1',
      userId: 'u1',
      threadId: 't1',
      createdAt: new Date(),
      thread: {
        id: 't1',
        title: '收藏帖',
        deletedAt: null,
        owner: { id: 'u2', username: 'morenk', avatar: null },
        _count: { members: 1, posts: 2 },
      },
    };
    mockPrisma.userBookmark.findMany.mockResolvedValue([bookmark]);

    const result = await service.findAll('u1');

    expect(result.items[0]).toMatchObject({ id: 't1', title: '收藏帖' });
    expect(result.items[0]).toEqual(expect.objectContaining({ bookmarkId: 'bm1' }));
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', thread: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('findAll 使用收藏 ID 作为分页游标且限制最大页长', async () => {
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      { id: 'bm1', thread: { id: 'thread-1', deletedAt: null } },
      { id: 'bm2', thread: { id: 'thread-2', deletedAt: null } },
    ]);

    const result = await service.findAll('u1', 'bm-before', 100);

    expect(result.items).toHaveLength(2);
    expect(result.pagination).toEqual({ cursor: 'bm2', hasMore: false });
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 51,
      cursor: { id: 'bm-before' },
      skip: 1,
    }));
  });

  it('findAll 多取一条判断下一页并移除探测记录', async () => {
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      { id: 'bm1', thread: { id: 'thread-1', deletedAt: null } },
      { id: 'bm2', thread: { id: 'thread-2', deletedAt: null } },
    ]);

    const result = await service.findAll('u1', undefined, 1);

    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({ cursor: 'bm1', hasMore: true });
  });

  it('findByUserId 目标用户不存在或未公开时返回统一 404', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.findByUserId('missing', 'viewer')).rejects.toThrow('用户不存在');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing', deletedAt: null },
      select: { id: true, showBookmarks: true, deletedAt: true },
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'target',
      showBookmarks: false,
      deletedAt: null,
    });
    await expect(service.findByUserId('target', 'viewer')).rejects.toThrow('该用户未公开收藏');
    expect(mockPrisma.userBookmark.findMany).not.toHaveBeenCalled();
  });

  it('匿名查看只在数据库层读取已发布公开主题', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: true,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([]);

    await service.findByUserId('target');

    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'target',
        thread: { deletedAt: null, published: true, visibility: 'PUBLIC' },
      },
    }));
  });

  it('其他登录用户可读取公开主题及自己参与的私密主题', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: true,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([]);

    await service.findByUserId('target', 'viewer');

    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'target',
        thread: {
          deletedAt: null,
          published: true,
          OR: [
            { visibility: 'PUBLIC' },
            { visibility: 'PRIVATE', members: { some: { userId: 'viewer' } } },
          ],
        },
      },
    }));
  });

  it('公开收藏分页返回 bookmark ID 而不是 thread ID', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: true,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      { id: 'bookmark-1', thread: { id: 'thread-1' } },
      { id: 'bookmark-2', thread: { id: 'thread-2' } },
    ]);

    const result = await service.findByUserId('target', 'target', undefined, 1);

    expect(result.items).toEqual([{ id: 'thread-1' }]);
    expect(result.pagination).toEqual({ cursor: 'bookmark-1', hasMore: true });
  });

  it('create 私密帖非参与人返回 404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE', published: true });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);

    await expect(service.create('u1', 't1')).rejects.toMatchObject({
      errorCode: ErrorCode.THREAD_NOT_FOUND,
    });
  });

  it('create 拒绝不存在、未发布和重复收藏的主题', async () => {
    mockPrisma.thread.findUnique.mockResolvedValueOnce(null);
    await expect(service.create('u1', 'missing')).rejects.toMatchObject({
      errorCode: ErrorCode.THREAD_NOT_FOUND,
    });

    mockPrisma.thread.findUnique.mockResolvedValueOnce({
      id: 't1',
      visibility: 'PUBLIC',
      published: false,
    });
    await expect(service.create('u1', 't1')).rejects.toMatchObject({
      errorCode: ErrorCode.THREAD_NOT_FOUND,
    });

    mockPrisma.thread.findUnique.mockResolvedValueOnce({
      id: 't1',
      visibility: 'PUBLIC',
      published: true,
    });
    mockPrisma.userBookmark.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('u1', 't1')).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
  });

  it('create 写入公开主题收藏', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({
      id: 't1',
      visibility: 'PUBLIC',
      published: true,
    });
    mockPrisma.userBookmark.findUnique.mockResolvedValue(null);
    mockPrisma.userBookmark.create.mockResolvedValue({ id: 'bm1' });

    await expect(service.create('u1', 't1')).resolves.toEqual({ id: 'bm1' });
    expect(mockPrisma.userBookmark.create).toHaveBeenCalledWith({
      data: { userId: 'u1', threadId: 't1' },
    });
  });

  it('remove 只允许收藏所有者删除', async () => {
    mockPrisma.userBookmark.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove('missing', 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });

    mockPrisma.userBookmark.findUnique.mockResolvedValueOnce({ id: 'bm1', userId: 'other' });
    await expect(service.remove('bm1', 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });

    mockPrisma.userBookmark.findUnique.mockResolvedValueOnce({ id: 'bm1', userId: 'u1' });
    mockPrisma.userBookmark.delete.mockResolvedValue({ id: 'bm1' });
    await expect(service.remove('bm1', 'u1')).resolves.toEqual({ id: 'bm1' });
    expect(mockPrisma.userBookmark.delete).toHaveBeenCalledWith({ where: { id: 'bm1' } });
  });
});
