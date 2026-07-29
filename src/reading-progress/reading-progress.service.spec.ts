import { Test, TestingModule } from '@nestjs/testing';
import { ReadingProgressService } from './reading-progress.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  userReadProgress: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  post: {
    count: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe('ReadingProgressService', () => {
  let service: ReadingProgressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingProgressService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ReadingProgressService>(ReadingProgressService);
    jest.clearAllMocks();
  });

  // ── findBySubthread ──

  it('findBySubthread 应该返回进度', async () => {
    mockPrisma.userReadProgress.findUnique.mockResolvedValue({
      id: 'rp1', userId: 'u1', postId: 'p1',
      post: { id: 'p1', floorNumber: 3 },
    });
    const result = await service.findBySubthread('u1', 's1');
    expect(result?.postId).toBe('p1');
  });

  // ── findAll ──

  it('findAll 应该返回所有进度并过滤已软删除的子贴', async () => {
    const mockProgress = [
      { id: 'rp1', userId: 'u1', postId: 'p1', subthread: { id: 's1', title: '主区', threadId: 't1' }, post: { id: 'p1', floorNumber: 5 } },
    ];
    mockPrisma.userReadProgress.findMany.mockResolvedValue(mockProgress);
    const result = await service.findAll('u1');
    expect(result).toEqual(mockProgress);
    expect(mockPrisma.userReadProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', subthread: { deletedAt: null } }),
      }),
    );
  });

  // ── update ──

  it('update 应该 upsert 进度', async () => {
    mockPrisma.userReadProgress.upsert.mockResolvedValue({ id: 'rp1', postId: 'p2' });
    const result = await service.update('u1', 's1', 'p2');
    expect(result.postId).toBe('p2');
  });

  it('update 不传 postId 应该仅更新时间', async () => {
    mockPrisma.userReadProgress.upsert.mockResolvedValue({ id: 'rp1' });
    const result = await service.update('u1', 's1');
    expect(result.id).toBe('rp1');
  });

  // ── newRepliesSince ──

  it('newRepliesSince 从未读过返回全部帖数', async () => {
    mockPrisma.userReadProgress.findUnique.mockResolvedValue(null);
    mockPrisma.post.count.mockResolvedValue(42);
    const result = await service.newRepliesSince('u1', 's1');
    expect(result.newReplies).toBe(42);
    expect(result.totalPosts).toBe(42);
    expect(result.continueFrom).toBeNull();
  });

  it('newRepliesSince 用 post.createdAt 做锚点而非 updatedAt', async () => {
    const postCreatedAt = new Date('2026-07-28T12:00:00Z');
    const progressUpdatedAt = new Date('2026-07-29T12:00:00Z');
    mockPrisma.userReadProgress.findUnique.mockResolvedValue({
      userId: 'u1', subthreadId: 's1', postId: 'p1', updatedAt: progressUpdatedAt,
      post: { id: 'p1', createdAt: postCreatedAt, floorNumber: 30, parentPostId: null },
    });
    mockPrisma.post.count.mockResolvedValueOnce(100).mockResolvedValueOnce(28);

    const result = await service.newRepliesSince('u1', 's1');

    // 第二次 count 调用应该用 post.createdAt 做锚点
    expect(mockPrisma.post.count).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { gt: postCreatedAt },
      }),
    }));
    expect(result.newReplies).toBe(28);
    expect(result.totalPosts).toBe(100);
    expect(result.lastReadPostId).toBe('p1');
    expect(result.continueFrom).not.toBeNull();
    expect(result.continueFrom!.floorNumber).toBe(30);
  });

  it('newRepliesSince 无 postId 时用 updatedAt 做锚点', async () => {
    const progressUpdatedAt = new Date('2026-07-28T12:00:00Z');
    mockPrisma.userReadProgress.findUnique.mockResolvedValue({
      userId: 'u1', subthreadId: 's1', postId: null, updatedAt: progressUpdatedAt,
      post: null,
    });
    mockPrisma.post.count.mockResolvedValueOnce(50).mockResolvedValueOnce(10);

    const result = await service.newRepliesSince('u1', 's1');

    // 第二次 count 应该用 updatedAt 做锚点
    expect(mockPrisma.post.count).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { gt: progressUpdatedAt },
      }),
    }));
    expect(result.newReplies).toBe(10);
    expect(result.continueFrom).toBeNull();
  });
});

