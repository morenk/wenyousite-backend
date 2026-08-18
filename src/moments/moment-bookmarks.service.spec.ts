import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { PrismaService } from '../prisma/prisma.service';
import { MomentBookmarksService } from './moment-bookmarks.service';
import { MomentsService } from './moments.service';

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
  const tx = {
    momentBookmark: {
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    moment: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    momentBookmark: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const folders = { resolveFolder: jest.fn() };
  const moments = { assertVisible: jest.fn() };
  return { tx, prisma, folders, moments };
}

describe('MomentBookmarksService', () => {
  it('首次收藏到显式收藏夹并只增加一次计数', async () => {
    const { tx, prisma, folders, moments } = createMocks();
    const service = new MomentBookmarksService(
      prisma as unknown as PrismaService,
      folders as unknown as BookmarksService,
      moments as unknown as MomentsService,
    );
    tx.momentBookmark.findUnique.mockResolvedValue(null);
    folders.resolveFolder.mockResolvedValue({ id: 'folder-custom' });
    tx.momentBookmark.createMany.mockResolvedValue({ count: 1 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ bookmarkCount: 4 });

    await expect(
      service.set('moment-1', { id: 'viewer-1' }, true, 'folder-custom'),
    ).resolves.toEqual({ momentId: 'moment-1', count: 4, active: true });

    expect(moments.assertVisible).toHaveBeenCalledWith('moment-1', 'viewer-1');
    expect(tx.momentBookmark.createMany).toHaveBeenCalledWith({
      data: [{ momentId: 'moment-1', userId: 'viewer-1', folderId: 'folder-custom' }],
      skipDuplicates: true,
    });
    expect(tx.moment.update).toHaveBeenCalledWith({
      where: { id: 'moment-1' },
      data: { bookmarkCount: { increment: 1 } },
    });
  });

  it('旧客户端重复收藏不会把已有分类移回默认夹', async () => {
    const { tx, prisma, folders, moments } = createMocks();
    const service = new MomentBookmarksService(
      prisma as unknown as PrismaService,
      folders as unknown as BookmarksService,
      moments as unknown as MomentsService,
    );
    tx.momentBookmark.findUnique.mockResolvedValue({ id: 'bookmark-1', folderId: 'folder-custom' });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ bookmarkCount: 3 });

    await service.set('moment-1', { id: 'viewer-1' }, true);

    expect(folders.resolveFolder).not.toHaveBeenCalled();
    expect(tx.momentBookmark.update).not.toHaveBeenCalled();
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it('我的动态收藏可按收藏夹筛选并返回私有归类字段', async () => {
    const { prisma, folders, moments } = createMocks();
    const service = new MomentBookmarksService(
      prisma as unknown as PrismaService,
      folders as unknown as BookmarksService,
      moments as unknown as MomentsService,
    );
    folders.resolveFolder.mockResolvedValue({ id: 'folder-custom' });
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
    const { prisma, folders, moments } = createMocks();
    const service = new MomentBookmarksService(
      prisma as unknown as PrismaService,
      folders as unknown as BookmarksService,
      moments as unknown as MomentsService,
    );
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'owner-1', showBookmarks: false });
    await expect(service.listPublic('owner-1', 'viewer-1')).rejects.toBeInstanceOf(
      NotFoundException,
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
    const { tx, prisma, folders, moments } = createMocks();
    const service = new MomentBookmarksService(
      prisma as unknown as PrismaService,
      folders as unknown as BookmarksService,
      moments as unknown as MomentsService,
    );
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', showBookmarks: true });
    prisma.momentBookmark.findFirst.mockResolvedValue(null);
    await expect(
      service.listPublic('owner-1', 'viewer-1', 'foreign-cursor'),
    ).rejects.toBeInstanceOf(BadRequestException);

    folders.resolveFolder.mockResolvedValue({ id: 'folder-2' });
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
});
