import { Test, TestingModule } from '@nestjs/testing';
import { BookmarksService } from './bookmarks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  userBookmark: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  bookmarkFolder: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  thread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn(), groupBy: jest.fn() },
  $transaction: jest.fn(),
};

const threadCardRow = (id: string, content = '', visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') => ({
  id,
  title: `主题 ${id}`,
  category: 'MYSTERY',
  status: 'RECRUITING',
  visibility,
  published: true,
  pinned: false,
  tipTotal: 0n,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  deletedAt: null,
  owner: { id: 'u2', username: 'morenk', avatar: null, level: 2, deletedAt: null },
  defaultSubthread: {
    id: `sub-${id}`,
    title: '主贴',
    lastPostAt: null,
    posts: content ? [{ content }] : [],
  },
  topicTags: [{ tag: { id: 'tag-1', name: '推理' } }],
  _count: { members: 1, posts: 2 },
});

describe('BookmarksService', () => {
  let service: BookmarksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BookmarksService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<BookmarksService>(BookmarksService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.threadMember.groupBy.mockResolvedValue([]);
    mockPrisma.bookmarkFolder.upsert.mockResolvedValue({
      id: 'cfolderdefault000000000001',
      userId: 'u1',
      name: '默认收藏夹',
      isDefault: true,
    });
  });

  it('findAll 返回值附带 bookmarkId（供取消收藏）', async () => {
    const bookmark = {
      id: 'bm1',
      userId: 'u1',
      threadId: 't1',
      folderId: 'folder-1',
      createdAt: new Date(),
      thread: {
        ...threadCardRow('t1', '收藏正文\n![封面](https://cdn.example.com/bookmark-cover.jpg)'),
        title: '收藏帖',
      },
    };
    mockPrisma.userBookmark.findMany.mockResolvedValue([bookmark]);
    mockPrisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 3 }]);

    const result = await service.findAll('u1');

    expect(result.items[0]).toMatchObject({ id: 't1', title: '收藏帖' });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        bookmarkId: 'bm1',
        bookmarkFolderId: 'folder-1',
        preview: '收藏正文',
        coverImages: ['https://cdn.example.com/bookmark-cover.jpg'],
        defaultSubthread: { id: 'sub-t1', title: '主贴', lastPostAt: null },
        topicTags: [{ tag: { id: 'tag-1', name: '推理' } }],
        _count: { members: 1, posts: 2, players: 3 },
      }),
    );
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          thread: {
            deletedAt: null,
            published: true,
            OR: [
              { visibility: 'PUBLIC' },
              {
                visibility: 'PRIVATE',
                members: { some: { userId: 'u1' } },
              },
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('findAll 使用收藏 ID 作为分页游标且限制最大页长', async () => {
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      { id: 'bm1', folderId: 'folder-1', thread: threadCardRow('thread-1') },
      { id: 'bm2', folderId: 'folder-1', thread: threadCardRow('thread-2') },
    ]);

    const result = await service.findAll('u1', 'bm-before', 100);

    expect(result.items).toHaveLength(2);
    expect(result.pagination).toEqual({ cursor: 'bm2', hasMore: false });
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 51,
        cursor: { id: 'bm-before' },
        skip: 1,
      }),
    );
  });

  it('findAll 多取一条判断下一页并移除探测记录', async () => {
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      { id: 'bm1', folderId: 'folder-1', thread: threadCardRow('thread-1') },
      { id: 'bm2', folderId: 'folder-1', thread: threadCardRow('thread-2') },
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

    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'target',
          thread: { deletedAt: null, published: true, visibility: 'PUBLIC' },
        },
      }),
    );
  });

  it('其他登录用户可读取公开主题及自己参与的私密主题', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: true,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([]);

    await service.findByUserId('target', 'viewer');

    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
  });

  it('本人也不能读取已经失去成员资格的私密收藏', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: false,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([]);

    await service.findByUserId('target', 'target');

    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'target',
          thread: {
            deletedAt: null,
            published: true,
            OR: [
              { visibility: 'PUBLIC' },
              {
                visibility: 'PRIVATE',
                members: { some: { userId: 'target' } },
              },
            ],
          },
        },
      }),
    );
  });

  it('公开收藏分页返回 bookmark ID 而不是 thread ID', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'target',
      showBookmarks: true,
      deletedAt: null,
    });
    mockPrisma.userBookmark.findMany.mockResolvedValue([
      {
        id: 'bookmark-1',
        thread: threadCardRow(
          'thread-1',
          '公开收藏正文\n![封面](https://cdn.example.com/public-cover.jpg)',
        ),
      },
      { id: 'bookmark-2', thread: threadCardRow('thread-2') },
    ]);

    const result = await service.findByUserId('target', 'target', undefined, 1);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'thread-1',
        preview: '公开收藏正文',
        coverImages: ['https://cdn.example.com/public-cover.jpg'],
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty('bookmarkId');
    expect(result.pagination).toEqual({ cursor: 'bookmark-1', hasMore: true });
  });

  it('create 私密帖非参与人返回 404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({
      id: 't1',
      visibility: 'PRIVATE',
      published: true,
    });
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
      data: {
        userId: 'u1',
        threadId: 't1',
        folderId: 'cfolderdefault000000000001',
      },
    });
  });

  it('不指定收藏夹时自动归入默认收藏夹', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({
      id: 't1',
      visibility: 'PUBLIC',
      published: true,
    });
    mockPrisma.userBookmark.findUnique.mockResolvedValue(null);
    mockPrisma.userBookmark.create.mockResolvedValue({ id: 'bm1' });

    await service.create('u1', 't1');

    expect(mockPrisma.bookmarkFolder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_name: { userId: 'u1', name: '默认收藏夹' },
        },
      }),
    );
  });

  it('可以创建收藏夹并返回收藏数量', async () => {
    mockPrisma.bookmarkFolder.create.mockResolvedValue({
      id: 'cfoldercustom00000000001',
      userId: 'u1',
      name: '跑团资料',
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.createFolder('u1', '  跑团资料  ')).resolves.toMatchObject({
      name: '跑团资料',
      bookmarkCount: 0,
    });
    expect(mockPrisma.bookmarkFolder.create).toHaveBeenCalledWith({
      data: { userId: 'u1', name: '跑团资料' },
    });
  });

  it('收藏夹列表只返回公开字段和收藏数量', async () => {
    mockPrisma.bookmarkFolder.findMany.mockResolvedValue([
      {
        id: 'cfolderdefault000000000001',
        userId: 'u1',
        name: '默认收藏夹',
        isDefault: true,
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z'),
        _count: { bookmarks: 3 },
      },
    ]);

    const result = await service.findFolders('u1');

    expect(result).toEqual([
      {
        id: 'cfolderdefault000000000001',
        name: '默认收藏夹',
        isDefault: true,
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        bookmarkCount: 3,
      },
    ]);
    expect(result[0]).not.toHaveProperty('userId');
    expect(result[0]).not.toHaveProperty('updatedAt');
  });

  it('按收藏夹筛选时校验归属并只查询该分类', async () => {
    mockPrisma.bookmarkFolder.findFirst.mockResolvedValue({ id: 'cfoldercustom00000000001' });
    mockPrisma.userBookmark.findMany.mockResolvedValue([]);

    await service.findAll('u1', undefined, 20, 'cfoldercustom00000000001');

    expect(mockPrisma.bookmarkFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'cfoldercustom00000000001', userId: 'u1' },
    });
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ folderId: 'cfoldercustom00000000001' }),
      }),
    );
  });

  it('只能把自己的收藏移动到自己的收藏夹', async () => {
    mockPrisma.userBookmark.findFirst.mockResolvedValue({ id: 'bm1', userId: 'u1' });
    mockPrisma.bookmarkFolder.findFirst.mockResolvedValue({ id: 'cfoldercustom00000000001' });
    mockPrisma.userBookmark.update.mockResolvedValue({
      id: 'bm1',
      folderId: 'cfoldercustom00000000001',
    });

    await service.move('bm1', 'u1', 'cfoldercustom00000000001');

    expect(mockPrisma.userBookmark.update).toHaveBeenCalledWith({
      where: { id: 'bm1' },
      data: { folderId: 'cfoldercustom00000000001' },
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
