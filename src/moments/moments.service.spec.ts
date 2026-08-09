import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MomentsService } from './moments.service';
import { MomentFeedMode } from './dto/moment-query.dto';

const now = new Date('2026-08-08T12:00:00.000Z');

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'moment-1',
    authorId: 'user-1',
    author: {
      id: 'user-1',
      username: '温油用户',
      avatar: null,
      level: 1,
      deletedAt: null,
    },
    title: '第一条动态',
    content: '正文',
    textCoverTheme: 'ROSE',
    coverMedia: null,
    likeCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
    tipTotal: 0n,
    version: 1,
    createdAt: now,
    updatedAt: now,
    likes: [],
    bookmarks: [],
    _count: { images: 0 },
    images: [],
    ...overrides,
  };
}

function createPrismaMock() {
  const tx = {
    moment: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    momentImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    momentLike: { createMany: jest.fn(), deleteMany: jest.fn() },
    momentBookmark: { createMany: jest.fn(), deleteMany: jest.fn() },
  };
  const prisma = {
    moment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    media: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    momentBookmark: { findFirst: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const redis = {
    zaddMulti: jest.fn(),
    zrange: jest.fn(),
    expire: jest.fn(),
  };
  return { prisma, tx, redis };
}

describe('MomentsService', () => {
  it('关注流要求登录', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);

    await expect(service.list(MomentFeedMode.FOLLOWING, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('发布纯文字动态时裁剪文本并生成稳定文字封面', async () => {
    const { prisma, tx, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.moment.findUnique.mockResolvedValue(null);
    tx.moment.create.mockResolvedValue({ id: 'moment-1' });
    prisma.moment.findFirst.mockResolvedValue(detailRow());

    const result = await service.create(
      {
        title: '  第一条动态  ',
        content: '  正文  ',
        mediaIds: [],
        clientRequestId: '00000000-0000-4000-8000-000000000002',
      },
      { id: 'user-1' },
    );

    expect(tx.moment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '第一条动态',
          content: '正文',
          coverMediaId: null,
          textCoverTheme: 'MINT',
        }),
      }),
    );
    expect(result.coverType).toBe('TEXT');
    expect(result.canEdit).toBe(true);
  });

  it('幂等键被不同内容复用时拒绝发布', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.moment.findUnique.mockResolvedValue({ id: 'moment-1', createRequestHash: 'different' });

    await expect(
      service.create(
        {
          title: '另一条动态',
          content: '',
          mediaIds: [],
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('封面必须属于动态图片', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.moment.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        {
          title: '图片动态',
          content: '',
          mediaIds: ['media-1'],
          coverMediaId: 'media-2',
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('重复点赞不会重复增加计数', async () => {
    const { prisma, tx, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.moment.findFirst.mockResolvedValue({
      id: 'moment-1',
      authorId: 'user-2',
      title: '动态',
    });
    tx.momentLike.createMany.mockResolvedValue({ count: 0 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ likeCount: 7 });

    await expect(service.setLike('moment-1', { id: 'user-1' }, true)).resolves.toEqual({
      momentId: 'moment-1',
      count: 7,
      active: true,
    });
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it('编辑版本冲突时要求刷新', async () => {
    const { prisma, tx, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.moment.findUnique.mockResolvedValue({
      authorId: 'user-1',
      coverMediaId: null,
      images: [],
    });
    tx.moment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update('moment-1', { title: '修改', version: 1 }, { id: 'user-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('动态搜索拒绝单字符关键词', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);

    await expect(service.search('字', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('发现流排名后二次装载仍会重新应用双向拉黑可见性', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.$queryRaw.mockResolvedValue([{ id: 'moment-1', score: 1, createdAt: now }]);
    prisma.moment.findMany.mockResolvedValue([]);

    await service.list(MomentFeedMode.DISCOVER, undefined, 20, { id: 'viewer-1' });

    expect(prisma.moment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['moment-1'] },
          deletedAt: null,
          author: {
            userBlocks: { none: { blockedId: 'viewer-1' } },
            blockedBy: { none: { blockerId: 'viewer-1' } },
          },
        }),
      }),
    );
  });

  it('发现流首屏固化候选顺序，并排除快照时间之后发布的动态', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    prisma.$queryRaw.mockResolvedValue([
      { id: 'moment-1' },
      { id: 'moment-2' },
      { id: 'moment-3' },
    ]);
    prisma.moment.findMany.mockResolvedValue([
      detailRow({ id: 'moment-1' }),
      detailRow({ id: 'moment-2' }),
    ]);

    const result = await service.list(MomentFeedMode.DISCOVER, undefined, 2, {
      id: 'viewer-1',
    });

    expect(result.items.map((item) => item.id)).toEqual(['moment-1', 'moment-2']);
    expect(result.pagination.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(result.pagination.cursor!, 'base64url').toString('utf8'),
    ) as { snapshotId: string; offset: number };
    expect(decoded).toEqual({ snapshotId: expect.any(String), offset: 2 });
    const snapshotKey = `moments:discover:snapshot:${decoded.snapshotId}`;
    expect(redis.zaddMulti).toHaveBeenCalledWith(
      snapshotKey,
      0,
      'moment-1',
      1,
      'moment-2',
      2,
      'moment-3',
    );
    expect(redis.expire).toHaveBeenCalledWith(snapshotKey, 15 * 60);
    const query = prisma.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(query.strings.join(' ')).toContain('m."created_at" <=');
  });

  it('发现流后续页只读取固定快照，不受实时排名变化影响', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    const snapshotId = '550e8400-e29b-41d4-a716-446655440000';
    const cursor = Buffer.from(JSON.stringify({ snapshotId, offset: 2 })).toString('base64url');
    redis.zrange.mockResolvedValue(['moment-3', 'moment-4']);
    prisma.moment.findMany.mockResolvedValue([detailRow({ id: 'moment-3' })]);

    const result = await service.list(MomentFeedMode.DISCOVER, cursor, 1, {
      id: 'viewer-1',
    });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.zrange).toHaveBeenCalledWith(`moments:discover:snapshot:${snapshotId}`, 2, 3);
    expect(result.items.map((item) => item.id)).toEqual(['moment-3']);
    expect(result.pagination.hasMore).toBe(true);
    const next = JSON.parse(
      Buffer.from(result.pagination.cursor!, 'base64url').toString('utf8'),
    ) as { snapshotId: string; offset: number };
    expect(next).toEqual({ snapshotId, offset: 3 });
  });

  it('发现流快照过期后要求客户端刷新', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = new MomentsService(prisma as never, redis as never);
    const cursor = Buffer.from(
      JSON.stringify({
        snapshotId: '550e8400-e29b-41d4-a716-446655440000',
        offset: 20,
      }),
    ).toString('base64url');
    redis.zrange.mockResolvedValue([]);

    await expect(
      service.list(MomentFeedMode.DISCOVER, cursor, 20, { id: 'viewer-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
