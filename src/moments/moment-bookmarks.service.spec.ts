import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MomentBookmarksService } from './moment-bookmarks.service';
import { MomentAccessService } from './moment-access.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

const now = new Date('2026-08-18T12:00:00.000Z');

function cardRow() {
  return {
    id: 'moment-1',
    authorId: 'author-1',
    author: {
      id: 'author-1',
      username: '温油用户',
      avatar: null,
      level: 1,
      deletedAt: null,
    },
    title: '收藏动态',
    content: '正文',
    textCoverTheme: 'ROSE',
    coverMedia: null,
    likeCount: 1,
    commentCount: 2,
    bookmarkCount: 3,
    tipTotal: 0n,
    version: 1,
    createdAt: now,
    updatedAt: now,
    likes: [],
    bookmarks: [{ id: 'moment-bookmark-1' }],
    _count: { images: 0 },
  };
}

function createMocks() {
  const momentBookmarkFolder = {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const tx = {
    momentBookmark: {
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    moment: { update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    momentBookmarkFolder: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    bookmarkFolder: { findFirst: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    momentBookmark: { findFirst: jest.fn(), findMany: jest.fn() },
    momentBookmarkFolder,
    bookmarkFolder: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  momentBookmarkFolder.upsert.mockResolvedValue({
    id: 'folder-default',
    userId: 'viewer-1',
    name: '默认收藏夹',
    isDefault: true,
  });
  const moments = {
    assertVisible: jest.fn(),
    lockVisible: jest.fn().mockResolvedValue({
      id: 'moment-1',
      authorId: 'author-1',
      title: '收藏动态',
      author: { deletedAt: null },
    }),
    assertCanAddInteraction: jest.fn(),
  };
  return { tx, prisma, moments };
}

function createService(
  prisma: ReturnType<typeof createMocks>['prisma'],
  moments: ReturnType<typeof createMocks>['moments'],
) {
  return new MomentBookmarksService(
    prisma as unknown as PrismaService,
    moments as unknown as MomentAccessService,
  );
}

async function expectBusiness(promise: Promise<unknown>, errorCode: number, status: HttpStatus) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(BusinessException);
  expect(error).toMatchObject({ errorCode });
  expect((error as BusinessException).getStatus()).toBe(status);
}

describe('MomentBookmarksService', () => {
  it('动态收藏夹使用独立目录和独立数量', async () => {
    const { prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    prisma.momentBookmarkFolder.findMany.mockResolvedValue([
      {
        id: 'moment-folder-default',
        userId: 'viewer-1',
        name: '默认收藏夹',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        _count: { bookmarks: 2 },
      },
    ]);

    await expect(service.listFolders('viewer-1')).resolves.toEqual([
      {
        id: 'moment-folder-default',
        name: '默认收藏夹',
        isDefault: true,
        createdAt: now,
        momentBookmarkCount: 2,
      },
    ]);
    expect(prisma.momentBookmarkFolder.findMany).toHaveBeenCalledWith({
      where: { userId: 'viewer-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { bookmarks: true } } },
    });
    expect(prisma.bookmarkFolder.findFirst).not.toHaveBeenCalled();
  });

  it('动态夹可创建与主题帖夹同名的独立目录', async () => {
    const { prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    prisma.momentBookmarkFolder.create.mockResolvedValue({
      id: 'moment-folder-custom',
      userId: 'viewer-1',
      name: '稍后阅读',
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    await expect(service.createFolder('viewer-1', '  稍后阅读  ')).resolves.toEqual({
      id: 'moment-folder-custom',
      name: '稍后阅读',
      isDefault: false,
      createdAt: now,
      momentBookmarkCount: 0,
    });
    expect(prisma.momentBookmarkFolder.create).toHaveBeenCalledWith({
      data: { userId: 'viewer-1', name: '稍后阅读' },
    });
  });

  it('首次收藏到显式收藏夹并只增加一次计数', async () => {
    const { tx, prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    tx.momentBookmark.findUnique.mockResolvedValue(null);
    tx.momentBookmarkFolder.findFirst.mockResolvedValue({ id: 'folder-custom' });
    tx.momentBookmark.createMany.mockResolvedValue({ count: 1 });
    tx.moment.updateMany.mockResolvedValue({ count: 1 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ bookmarkCount: 4 });

    await expect(
      service.set('moment-1', { id: 'viewer-1' }, true, 'folder-custom'),
    ).resolves.toEqual({ momentId: 'moment-1', count: 4, active: true });

    expect(moments.lockVisible).toHaveBeenCalledWith(tx, 'moment-1', 'viewer-1');
    expect(tx.momentBookmark.createMany).toHaveBeenCalledWith({
      data: [{ momentId: 'moment-1', userId: 'viewer-1', folderId: 'folder-custom' }],
      skipDuplicates: true,
    });
    expect(tx.moment.updateMany).toHaveBeenCalledWith({
      where: { id: 'moment-1', deletedAt: null },
      data: { bookmarkCount: { increment: 1 } },
    });
  });

  it('旧客户端重复收藏不会把已有分类移回默认夹', async () => {
    const { tx, prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    tx.momentBookmark.findUnique.mockResolvedValue({ id: 'bookmark-1', folderId: 'folder-custom' });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ bookmarkCount: 3 });

    await service.set('moment-1', { id: 'viewer-1' }, true);

    expect(tx.momentBookmarkFolder.upsert).not.toHaveBeenCalled();
    expect(tx.momentBookmarkFolder.findFirst).not.toHaveBeenCalled();
    expect(tx.momentBookmark.update).not.toHaveBeenCalled();
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
  });

  it('我的动态收藏可按收藏夹筛选并返回私有归类字段', async () => {
    const { prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    prisma.momentBookmarkFolder.findFirst.mockResolvedValue({ id: 'folder-custom' });
    prisma.momentBookmark.findMany.mockResolvedValue([
      { id: 'bookmark-1', folderId: 'folder-custom', moment: cardRow() },
    ]);

    const result = await service.listMine(undefined, 20, { id: 'viewer-1' }, 'folder-custom');

    expect(result.items[0]).toMatchObject({
      id: 'moment-1',
      bookmarkFolderId: 'folder-custom',
      viewerBookmarked: true,
    });
    expect(prisma.momentBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'viewer-1', folderId: 'folder-custom' }),
      }),
    );
  });

  it('公开动态收藏服从隐私开关且不泄露收藏夹字段', async () => {
    const { prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'owner-1', showBookmarks: false });
    await expectBusiness(
      service.listPublic('owner-1', 'viewer-1'),
      ErrorCode.NOT_FOUND,
      HttpStatus.NOT_FOUND,
    );

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'owner-1', showBookmarks: true });
    prisma.momentBookmark.findMany.mockResolvedValue([
      { id: 'bookmark-1', folderId: 'folder-private', moment: cardRow() },
    ]);
    const result = await service.listPublic('owner-1', 'viewer-1');

    expect(result.items[0]).not.toHaveProperty('bookmarkFolderId');
    expect(prisma.momentBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          moment: {
            deletedAt: null,
            author: {
              userBlocks: { none: { blockedId: 'viewer-1' } },
              blockedBy: { none: { blockerId: 'viewer-1' } },
            },
          },
        }),
      }),
    );
  });

  it('拒绝其他用户的分页游标，并只移动自己的收藏', async () => {
    const { tx, prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', showBookmarks: true });
    prisma.momentBookmark.findFirst.mockResolvedValue(null);
    await expectBusiness(
      service.listPublic('owner-1', 'viewer-1', 'foreign-cursor'),
      ErrorCode.INVALID_CURSOR,
      HttpStatus.BAD_REQUEST,
    );

    tx.momentBookmarkFolder.findFirst.mockResolvedValue({ id: 'folder-2' });
    tx.momentBookmark.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.move('moment-1', 'viewer-1', 'folder-2')).resolves.toEqual({
      momentId: 'moment-1',
      folderId: 'folder-2',
    });
    expect(tx.momentBookmark.updateMany).toHaveBeenCalledWith({
      where: { momentId: 'moment-1', userId: 'viewer-1' },
      data: { folderId: 'folder-2' },
    });
  });

  it('兼容旧客户端的主题帖夹 ID，但实际写入同名动态夹', async () => {
    const { tx, prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    tx.momentBookmarkFolder.findFirst.mockResolvedValue(null);
    tx.bookmarkFolder.findFirst.mockResolvedValue({
      id: 'legacy-thread-folder',
      userId: 'viewer-1',
      name: '稍后阅读',
      isDefault: false,
    });
    tx.momentBookmarkFolder.findUnique.mockResolvedValue({
      id: 'independent-moment-folder',
      userId: 'viewer-1',
      name: '稍后阅读',
      isDefault: false,
    });
    tx.momentBookmark.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.move('moment-1', 'viewer-1', 'legacy-thread-folder')).resolves.toEqual({
      momentId: 'moment-1',
      folderId: 'independent-moment-folder',
    });
    expect(tx.momentBookmark.updateMany).toHaveBeenCalledWith({
      where: { momentId: 'moment-1', userId: 'viewer-1' },
      data: { folderId: 'independent-moment-folder' },
    });
  });

  it('已注销作者的历史动态拒绝新收藏但允许取消旧收藏', async () => {
    const { tx, prisma, moments } = createMocks();
    const service = createService(prisma, moments);
    moments.lockVisible.mockResolvedValue({
      id: 'moment-1',
      authorId: 'author-1',
      title: '历史动态',
      author: { deletedAt: new Date('2026-08-23T00:00:00.000Z') },
    });
    moments.assertCanAddInteraction.mockImplementation(() => {
      throw new BusinessException(ErrorCode.FORBIDDEN, '历史动态仅供阅读', HttpStatus.FORBIDDEN);
    });
    tx.momentBookmark.findUnique.mockResolvedValue(null);

    await expectBusiness(
      service.set('moment-1', { id: 'viewer-1' }, true),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
    expect(tx.momentBookmark.createMany).not.toHaveBeenCalled();

    tx.momentBookmark.deleteMany.mockResolvedValue({ count: 1 });
    tx.moment.updateMany.mockResolvedValue({ count: 1 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ bookmarkCount: 0 });
    await expect(service.set('moment-1', { id: 'viewer-1' }, false)).resolves.toEqual({
      momentId: 'moment-1',
      count: 0,
      active: false,
    });
  });
});
