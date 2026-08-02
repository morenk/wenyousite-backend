import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BookmarksService } from './bookmarks.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
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
    expect((result.items[0] as any).bookmarkId).toBe('bm1');
    expect(mockPrisma.userBookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('findAll 过滤已删除主题帖', async () => {
    const bookmark = {
      id: 'bm1',
      userId: 'u1',
      threadId: 't1',
      createdAt: new Date(),
      thread: { id: 't1', title: '已删', deletedAt: new Date(), owner: null, _count: null },
    };
    mockPrisma.userBookmark.findMany.mockResolvedValue([bookmark]);

    const result = await service.findAll('u1');
    expect(result.items).toHaveLength(0);
  });

  it('create 私密帖非参与人返回 404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE', published: true });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);

    await expect(service.create('u1', 't1')).rejects.toThrow(BusinessException);
    try {
      await service.create('u1', 't1');
    } catch (e: any) {
      expect(e.errorCode).toBe(ErrorCode.THREAD_NOT_FOUND);
    }
  });
});
