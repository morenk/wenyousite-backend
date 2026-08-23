import { HttpStatus } from '@nestjs/common';
import { MomentsService } from './moments.service';
import { MomentFeedMode } from './dto/moment-query.dto';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { hashIdempotencyPayload } from '../common/idempotency';

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
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    media: { findMany: jest.fn().mockResolvedValue([]) },
    momentImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    momentLike: { findUnique: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    momentBookmark: { createMany: jest.fn(), deleteMany: jest.fn() },
    $queryRaw: jest.fn(),
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
    zaddMultiWithExpiry: jest.fn(),
    zrange: jest.fn(),
    expire: jest.fn(),
  };
  const access = {
    assertVisible: jest.fn().mockResolvedValue({
      id: 'moment-1',
      authorId: 'user-2',
      title: '动态',
      author: { deletedAt: null },
    }),
    lockVisible: jest.fn().mockResolvedValue({
      id: 'moment-1',
      authorId: 'user-1',
      title: '动态',
      author: { deletedAt: null },
    }),
    assertCanAddInteraction: jest.fn(),
    lockActiveUser: jest.fn(),
  };
  return { prisma, tx, redis, access };
}

const mediaReferences = { reconcileMediaIds: jest.fn() };
const createService = (prisma: unknown, redis: unknown, access?: unknown) =>
  new MomentsService(
    prisma as never,
    redis as never,
    mediaReferences as never,
    (access ?? createPrismaMock().access) as never,
  );

async function expectBusiness(
  promise: Promise<unknown>,
  errorCode: number,
  status: HttpStatus,
) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(BusinessException);
  expect(error).toMatchObject({ errorCode });
  expect((error as BusinessException).getStatus()).toBe(status);
}

describe('MomentsService', () => {
  it('关注流要求登录', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);

    await expectBusiness(
      service.list(MomentFeedMode.FOLLOWING, undefined),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
  });

  it('发布纯文字动态时裁剪文本并生成稳定文字封面', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    prisma.moment.findUnique.mockResolvedValue(null);
    tx.moment.create.mockResolvedValue({ id: 'moment-1' });
    tx.moment.findUniqueOrThrow.mockResolvedValue(detailRow());

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
    expect(result.canInteract).toBe(true);
  });

  it('幂等键被不同内容复用时拒绝发布', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);
    prisma.moment.findUnique.mockResolvedValue({ id: 'moment-1', createRequestHash: 'different' });

    await expectBusiness(
      service.create(
        {
          title: '另一条动态',
          content: '',
          mediaIds: [],
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      HttpStatus.CONFLICT,
    );
  });

  it('完全相同的发布幂等重放不再进入写事务', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    const payload = {
      title: '原动态',
      content: '正文',
      mediaIds: [] as string[],
      coverMediaId: null,
    };
    prisma.moment.findUnique.mockResolvedValue({
      id: 'moment-1',
      createRequestHash: hashIdempotencyPayload(payload),
    });
    prisma.moment.findFirst.mockResolvedValue(detailRow({ title: payload.title }));

    await expect(
      service.create(
        {
          title: payload.title,
          content: payload.content,
          mediaIds: payload.mediaIds,
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'moment-1' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('封面必须属于动态图片', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);
    prisma.moment.findUnique.mockResolvedValue(null);

    await expectBusiness(
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
      ErrorCode.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
  });

  it('重复点赞不会重复增加计数', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    tx.momentLike.findUnique.mockResolvedValue({ id: 'like-1' });
    tx.momentLike.createMany.mockResolvedValue({ count: 0 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ likeCount: 7 });

    await expect(service.setLike('moment-1', { id: 'user-1' }, true)).resolves.toEqual({
      momentId: 'moment-1',
      count: 7,
      active: true,
    });
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
    expect(access.assertCanAddInteraction).not.toHaveBeenCalled();
  });

  it('编辑版本冲突时要求刷新', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    tx.moment.findUniqueOrThrow.mockResolvedValue({
      version: 2,
      coverMediaId: null,
      images: [],
    });

    await expectBusiness(
      service.update('moment-1', { title: '修改', version: 1 }, { id: 'user-1' }),
      ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      HttpStatus.CONFLICT,
    );
  });

  it('编辑动态在行锁内更新版本与返回详情', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    tx.moment.findUniqueOrThrow
      .mockResolvedValueOnce({ version: 1, coverMediaId: null, images: [] })
      .mockResolvedValueOnce(detailRow({ title: '新标题', version: 2 }));

    const result = await service.update(
      'moment-1',
      { title: '  新标题  ', version: 1 },
      { id: 'user-1' },
    );

    expect(tx.moment.update).toHaveBeenCalledWith({
      where: { id: 'moment-1' },
      data: expect.objectContaining({ title: '新标题', version: { increment: 1 } }),
    });
    expect(result).toEqual(expect.objectContaining({ title: '新标题', version: 2 }));
  });

  it('只允许动态作者编辑', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    access.lockVisible.mockResolvedValue({
      id: 'moment-1',
      authorId: 'user-2',
      title: '动态',
      author: { deletedAt: null },
    });

    await expectBusiness(
      service.update('moment-1', { title: '修改', version: 1 }, { id: 'user-1' }),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
  });

  it('删除动态、解除媒体引用和返回结果处于同一事务', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    tx.moment.findUnique.mockResolvedValue({
      authorId: 'user-1',
      deletedAt: null,
      coverMediaId: 'media-cover',
      images: [{ mediaId: 'media-1' }],
    });

    await expect(service.remove('moment-1', { id: 'user-1' })).resolves.toEqual({
      message: '动态已删除',
    });
    expect(tx.moment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'moment-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), removalSource: 'AUTHOR' }),
      }),
    );
    expect(tx.momentImage.deleteMany).toHaveBeenCalledWith({ where: { momentId: 'moment-1' } });
    expect(mediaReferences.reconcileMediaIds).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining(['media-1', 'media-cover']),
    );
  });

  it('新增与取消点赞只在关系实际变化时更新计数', async () => {
    const active = createPrismaMock();
    active.tx.momentLike.findUnique.mockResolvedValue(null);
    active.tx.momentLike.createMany.mockResolvedValue({ count: 1 });
    active.tx.moment.updateMany.mockResolvedValue({ count: 1 });
    active.tx.moment.findUniqueOrThrow.mockResolvedValue({ likeCount: 1 });
    await expect(
      createService(active.prisma, active.redis, active.access).setLike(
        'moment-1',
        { id: 'user-1' },
        true,
      ),
    ).resolves.toEqual({ momentId: 'moment-1', count: 1, active: true });
    expect(active.access.assertCanAddInteraction).toHaveBeenCalled();

    const inactive = createPrismaMock();
    inactive.tx.momentLike.deleteMany.mockResolvedValue({ count: 1 });
    inactive.tx.moment.updateMany.mockResolvedValue({ count: 1 });
    inactive.tx.moment.findUniqueOrThrow.mockResolvedValue({ likeCount: 0 });
    await expect(
      createService(inactive.prisma, inactive.redis, inactive.access).setLike(
        'moment-1',
        { id: 'user-1' },
        false,
      ),
    ).resolves.toEqual({ momentId: 'moment-1', count: 0, active: false });
  });

  it('动态搜索拒绝单字符关键词', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);

    await expectBusiness(
      service.search('字', undefined),
      ErrorCode.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('动态详情不存在时返回 40415', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    prisma.moment.findFirst.mockResolvedValue(null);

    await expectBusiness(
      service.findById('missing', { id: 'viewer-1' }),
      ErrorCode.MOMENT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
    );
  });

  it('用户动态列表对已注销用户继续返回 404', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    prisma.user.findUnique.mockResolvedValue(null);

    await expectBusiness(
      service.listUserMoments('deleted-user', undefined),
      ErrorCode.USER_NOT_FOUND,
      HttpStatus.NOT_FOUND,
    );
  });

  it('动态搜索拒绝无效游标', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);

    await expectBusiness(
      service.search('测试', 'invalid-cursor'),
      ErrorCode.INVALID_CURSOR,
      HttpStatus.BAD_REQUEST,
    );
  });

  it('发现流排名后二次装载仍会重新应用双向拉黑可见性', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);
    prisma.$queryRaw.mockResolvedValue([{ id: 'moment-1', score: 1, createdAt: now }]);
    prisma.moment.findMany.mockResolvedValue([]);

    await service.list(MomentFeedMode.DISCOVER, undefined, 20, { id: 'viewer-1' });

    expect(prisma.moment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['moment-1'] },
          deletedAt: null,
          author: {
            deletedAt: null,
            userBlocks: { none: { blockedId: 'viewer-1' } },
            blockedBy: { none: { blockerId: 'viewer-1' } },
          },
        }),
      }),
    );
  });

  it('发现流首屏固化候选顺序，并排除快照时间之后发布的动态', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);
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
    expect(redis.zaddMultiWithExpiry).toHaveBeenCalledWith(
      snapshotKey,
      15 * 60,
      0,
      'moment-1',
      1,
      'moment-2',
      2,
      'moment-3',
    );
    expect(redis.expire).not.toHaveBeenCalled();
    const query = prisma.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(query.strings.join(' ')).toContain('m."created_at" <=');
  });

  it('发现流后续页只读取固定快照，不受实时排名变化影响', async () => {
    const { prisma, redis } = createPrismaMock();
    const service = createService(prisma, redis);
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
    const service = createService(prisma, redis);
    const cursor = Buffer.from(
      JSON.stringify({
        snapshotId: '550e8400-e29b-41d4-a716-446655440000',
        offset: 20,
      }),
    ).toString('base64url');
    redis.zrange.mockResolvedValue([]);

    await expectBusiness(
      service.list(MomentFeedMode.DISCOVER, cursor, 20, { id: 'viewer-1' }),
      ErrorCode.INVALID_CURSOR,
      HttpStatus.BAD_REQUEST,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('新增互动会拒绝已注销作者的历史动态', async () => {
    const { prisma, tx, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    access.lockVisible.mockResolvedValue({
      id: 'moment-1',
      authorId: 'user-2',
      title: '历史动态',
      author: { deletedAt: new Date('2026-08-23T00:00:00.000Z') },
    });
    access.assertCanAddInteraction.mockImplementation(() => {
      throw new BusinessException(ErrorCode.FORBIDDEN, '历史动态仅供阅读', HttpStatus.FORBIDDEN);
    });
    tx.momentLike.findUnique.mockResolvedValue(null);

    await expectBusiness(
      service.setLike('moment-1', { id: 'user-1' }, true),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
    expect(tx.momentLike.createMany).not.toHaveBeenCalled();
  });

  it('显式搜索保留已注销作者的历史动态并返回不可互动标记', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    prisma.$queryRaw.mockResolvedValue([
      { id: 'moment-1', relevance: 1.5, createdAt: now },
    ]);
    prisma.moment.findMany.mockResolvedValue([
      detailRow({
        author: {
          id: 'user-1',
          username: '已注销用户',
          avatar: null,
          level: 1,
          deletedAt: new Date('2026-08-23T00:00:00.000Z'),
        },
      }),
    ]);

    const result = await service.search('历史动态', undefined, 20, { id: 'viewer-1' });

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'moment-1', canInteract: false }),
    ]);
    const query = prisma.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(query.strings.join(' ')).not.toContain('JOIN "users"');
  });

  it('发现流 Redis 写入或读取失败时返回可重试的 503', async () => {
    const first = createPrismaMock();
    first.prisma.$queryRaw.mockResolvedValue([{ id: 'moment-1' }, { id: 'moment-2' }]);
    first.prisma.moment.findMany.mockResolvedValue([detailRow()]);
    first.redis.zaddMultiWithExpiry.mockRejectedValue(new Error('redis unavailable'));
    await expectBusiness(
      createService(first.prisma, first.redis, first.access).list(
        MomentFeedMode.DISCOVER,
        undefined,
        1,
        { id: 'viewer-1' },
      ),
      ErrorCode.INTERNAL_ERROR,
      HttpStatus.SERVICE_UNAVAILABLE,
    );

    const next = createPrismaMock();
    next.redis.zrange.mockRejectedValue(new Error('redis unavailable'));
    const cursor = Buffer.from(
      JSON.stringify({
        snapshotId: '550e8400-e29b-41d4-a716-446655440000',
        offset: 1,
      }),
    ).toString('base64url');
    await expectBusiness(
      createService(next.prisma, next.redis, next.access).list(
        MomentFeedMode.DISCOVER,
        cursor,
        20,
        { id: 'viewer-1' },
      ),
      ErrorCode.INTERNAL_ERROR,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('非搜索列表的单页上限固定为 50', async () => {
    const { prisma, redis, access } = createPrismaMock();
    const service = createService(prisma, redis, access);
    prisma.moment.findMany.mockResolvedValue([]);

    await service.list(MomentFeedMode.FOLLOWING, undefined, 100, { id: 'viewer-1' });

    expect(prisma.moment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });
});
