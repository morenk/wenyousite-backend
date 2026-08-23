import { HttpStatus } from '@nestjs/common';
import { MomentCommentsService } from './moment-comments.service';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { hashIdempotencyPayload } from '../common/idempotency';

const author = (id: string, username = id) => ({
  id,
  username,
  avatar: null,
  level: 1,
  deletedAt: null,
});

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-new',
    momentId: 'moment-1',
    authorId: 'viewer',
    author: author('viewer'),
    content: '回复内容',
    media: null,
    sticker: null,
    parentCommentId: 'root-comment',
    replyToComment: { id: 'nested-comment', author: author('target') },
    deletedAt: null,
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    ...overrides,
  };
}

function createContext() {
  const tx = {
    momentComment: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    moment: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    media: { findUnique: jest.fn() },
    userBlock: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    momentComment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userBlock: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const moments = {
    assertVisible: jest.fn().mockResolvedValue({
      id: 'moment-1',
      authorId: 'moment-owner',
      title: '动态标题',
      author: { deletedAt: null },
    }),
    lockVisible: jest.fn().mockResolvedValue({
      id: 'moment-1',
      authorId: 'moment-owner',
      title: '动态标题',
      author: { deletedAt: null },
    }),
    assertCanAddInteraction: jest.fn(),
  };
  const outbox = { enqueue: jest.fn() };
  const stickers = { assertFavorite: jest.fn(), recordUsage: jest.fn() };
  const mediaReferences = { reconcileMediaIds: jest.fn() };
  return {
    prisma,
    tx,
    moments,
    outbox,
    stickers,
    service: new MomentCommentsService(
      prisma as never,
      moments as never,
      outbox as never,
      stickers as never,
      mediaReferences as never,
    ),
  };
}

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

describe('MomentCommentsService', () => {
  it('主评论支持倒序切换并把作者筛选贯穿根评论与楼中楼', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.momentComment.findMany.mockResolvedValue([
      {
        ...commentRow({
          id: 'root-comment',
          authorId: 'root-author',
          author: author('root-author'),
          parentCommentId: null,
          replyToComment: null,
        }),
        replies: [commentRow({ authorId: 'player', author: author('player') })],
        _count: { replies: 1 },
      },
    ]);

    const result = await service.listRoots(
      'moment-1',
      undefined,
      20,
      { id: 'viewer' },
      ReplyOrder.OLDEST,
      'player',
    );

    expect(result.items).toHaveLength(1);
    expect(prisma.momentComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: expect.objectContaining({
          replies: expect.objectContaining({
            where: expect.objectContaining({ authorId: 'player' }),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        }),
      }),
    );
  });

  it('楼中楼支持最新优先和作者筛选', async () => {
    const { service, prisma } = createContext();
    prisma.momentComment.findFirst.mockResolvedValue({ id: 'root-comment' });
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.momentComment.findMany.mockResolvedValue([
      commentRow({ authorId: 'player', author: author('player') }),
    ]);

    await service.listReplies(
      'moment-1',
      'root-comment',
      undefined,
      20,
      { id: 'viewer' },
      ReplyOrder.NEWEST,
      'player',
    );

    expect(prisma.momentComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorId: 'player' }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('回复者候选去重并按用户名排序', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.momentComment.findMany.mockResolvedValue([
      { author: author('u2', '周九') },
      { author: author('u1', '阿青') },
    ]);

    const result = await service.listAuthors('moment-1', { id: 'viewer' });

    expect(result.map((item) => item.username)).toEqual(['阿青', '周九']);
    expect(prisma.momentComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['authorId'] }),
    );
  });

  it('按楼中楼 ID 返回可直接注入的主评论上下文', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.momentComment.findFirst.mockResolvedValueOnce(commentRow()).mockResolvedValueOnce(
      commentRow({
        id: 'root-comment',
        authorId: 'root-author',
        author: author('root-author'),
        parentCommentId: null,
        replyToComment: null,
        deletedAt: new Date('2026-08-08T13:00:00.000Z'),
      }),
    );
    prisma.momentComment.count.mockResolvedValue(7);

    const result = await service.findContext('moment-1', 'comment-new', { id: 'viewer' });

    expect(result).toEqual(
      expect.objectContaining({
        root: expect.objectContaining({ id: 'root-comment', deleted: true, content: null }),
        target: expect.objectContaining({ id: 'comment-new', parentCommentId: 'root-comment' }),
        replyCount: 7,
      }),
    );
    expect(prisma.momentComment.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'comment-new',
          momentId: 'moment-1',
          deletedAt: null,
        }),
      }),
    );
  });

  it('按主评论 ID 返回自身作为目标', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.momentComment.findFirst.mockResolvedValue(
      commentRow({
        id: 'root-comment',
        parentCommentId: null,
        replyToComment: null,
      }),
    );
    prisma.momentComment.count.mockResolvedValue(2);

    const result = await service.findContext('moment-1', 'root-comment');

    expect(result.root.id).toBe('root-comment');
    expect(result.target.id).toBe('root-comment');
    expect(prisma.momentComment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('目标已删除或其作者被拉黑时不返回评论上下文', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'viewer', blockedId: 'blocked-author' },
    ]);
    prisma.momentComment.findFirst.mockResolvedValue(null);

    await expect(
      service.findContext('moment-1', 'hidden-comment', { id: 'viewer' }),
    ).rejects.toThrow('目标评论不存在或不可见');
    expect(prisma.momentComment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'hidden-comment',
          deletedAt: null,
          authorId: { notIn: ['blocked-author'] },
        }),
      }),
    );
  });

  it('楼中楼所属主评论作者被拉黑时不返回上下文', async () => {
    const { service, prisma } = createContext();
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'viewer', blockedId: 'blocked-root-author' },
    ]);
    prisma.momentComment.findFirst.mockResolvedValueOnce(commentRow()).mockResolvedValueOnce(null);

    await expect(service.findContext('moment-1', 'comment-new', { id: 'viewer' })).rejects.toThrow(
      '目标评论不存在或不可见',
    );
    expect(prisma.momentComment.count).not.toHaveBeenCalled();
  });

  it('回复楼中楼时统一归入主评论，并通知实际被回复者', async () => {
    const { service, prisma, tx, outbox } = createContext();
    tx.momentComment.findFirst.mockResolvedValue({
      id: 'nested-comment',
      authorId: 'target',
      parentCommentId: 'root-comment',
    });
    tx.userBlock.findFirst.mockResolvedValue(null);
    prisma.momentComment.findUnique.mockResolvedValue(null);
    tx.momentComment.create.mockResolvedValue({ id: 'comment-new' });
    tx.momentComment.findUniqueOrThrow.mockResolvedValue(commentRow());

    const result = await service.create(
      'moment-1',
      {
        content: '  回复内容  ',
        replyToCommentId: 'nested-comment',
        clientRequestId: '00000000-0000-4000-8000-000000000001',
      },
      { id: 'viewer', username: '回复者' },
    );

    expect(tx.momentComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentCommentId: 'root-comment',
          replyToCommentId: 'nested-comment',
          content: '回复内容',
        }),
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'moment.comment.created',
        payload: expect.objectContaining({ recipientId: 'target', isReply: true }),
      }),
    );
    expect(result.parentCommentId).toBe('root-comment');
  });

  it('允许只发一张已完成且未占用的图片，并把媒体写入幂等载荷', async () => {
    const { service, prisma, tx } = createContext();
    prisma.momentComment.findUnique.mockResolvedValue(null);
    tx.momentComment.findUniqueOrThrow.mockResolvedValue(
      commentRow({
        content: '',
        parentCommentId: null,
        replyToComment: null,
        media: {
          id: 'media-1',
          url: 'https://cdn.example.com/comment.webp',
          status: 'COMPLETED',
          width: 800,
          height: 1200,
        },
      }),
    );
    tx.media.findUnique.mockResolvedValue({
      userId: 'viewer',
      status: 'COMPLETED',
      directMessage: null,
      momentImages: [],
      momentComment: null,
    });
    tx.momentComment.create.mockResolvedValue({ id: 'comment-new' });

    const result = await service.create(
      'moment-1',
      {
        mediaId: 'media-1',
        clientRequestId: '00000000-0000-4000-8000-000000000001',
      },
      { id: 'viewer' },
    );

    expect(tx.momentComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: '', mediaId: 'media-1', stickerAssetId: null }),
      }),
    );
    expect(result.media).toEqual(expect.objectContaining({ id: 'media-1' }));
  });

  it('允许收藏表情评论并记录最近使用', async () => {
    const { service, prisma, tx, stickers } = createContext();
    prisma.momentComment.findUnique.mockResolvedValue(null);
    tx.momentComment.findUniqueOrThrow.mockResolvedValue(
      commentRow({
        content: '',
        parentCommentId: null,
        replyToComment: null,
        sticker: {
          id: 'sticker-1',
          url: 'https://cdn.example.com/sticker.webp',
          thumbnailUrl: 'https://cdn.example.com/sticker-thumb.webp',
          width: 320,
          height: 320,
          animated: true,
          frameCount: 8,
          durationMs: 900,
        },
      }),
    );
    tx.momentComment.create.mockResolvedValue({ id: 'comment-new' });

    const result = await service.create(
      'moment-1',
      {
        stickerAssetId: 'sticker-1',
        clientRequestId: '00000000-0000-4000-8000-000000000001',
      },
      { id: 'viewer' },
    );

    expect(stickers.assertFavorite).toHaveBeenCalledWith('viewer', 'sticker-1', tx);
    expect(stickers.recordUsage).toHaveBeenCalledWith('viewer', 'sticker-1', tx);
    expect(result.sticker).toEqual(expect.objectContaining({ id: 'sticker-1' }));
  });

  it('拒绝空评论以及同时选择图片和表情', async () => {
    const { service } = createContext();
    const clientRequestId = '00000000-0000-4000-8000-000000000001';

    await expectBusiness(
      service.create('moment-1', { clientRequestId }, { id: 'viewer' }),
      ErrorCode.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
    await expectBusiness(
      service.create(
        'moment-1',
        { content: '文字', mediaId: 'media-1', stickerAssetId: 'sticker-1', clientRequestId },
        { id: 'viewer' },
      ),
      ErrorCode.BAD_REQUEST,
      HttpStatus.BAD_REQUEST,
    );
  });

  it('存在双向任一拉黑关系时禁止回复', async () => {
    const { service, prisma, tx } = createContext();
    tx.momentComment.findFirst.mockResolvedValue({
      id: 'target-comment',
      authorId: 'target',
      parentCommentId: null,
    });
    tx.userBlock.findFirst.mockResolvedValue({ id: 'block-1' });
    prisma.momentComment.findUnique.mockResolvedValue(null);

    await expectBusiness(
      service.create(
        'moment-1',
        {
          content: '无法回复',
          replyToCommentId: 'target-comment',
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'viewer' },
      ),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
  });

  it('评论幂等键不得被复用到不同载荷', async () => {
    const { service, prisma } = createContext();
    prisma.momentComment.findUnique.mockResolvedValue({
      id: 'comment-existing',
      createRequestHash: hashIdempotencyPayload({
        momentId: 'moment-1',
        content: '原评论',
        mediaId: null,
        stickerAssetId: null,
        replyToCommentId: null,
      }),
    });

    await expectBusiness(
      service.create(
        'moment-1',
        {
          content: '新评论',
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'viewer' },
      ),
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      HttpStatus.CONFLICT,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('已注销作者的历史动态拒绝新评论', async () => {
    const { service, prisma, tx, moments } = createContext();
    prisma.momentComment.findUnique.mockResolvedValue(null);
    moments.lockVisible.mockResolvedValue({
      id: 'moment-1',
      authorId: 'moment-owner',
      title: '历史动态',
      author: { deletedAt: new Date('2026-08-23T00:00:00.000Z') },
    });
    moments.assertCanAddInteraction.mockImplementation(() => {
      throw new BusinessException(ErrorCode.FORBIDDEN, '历史动态仅供阅读', HttpStatus.FORBIDDEN);
    });

    await expectBusiness(
      service.create(
        'moment-1',
        {
          content: '新评论',
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'viewer' },
      ),
      ErrorCode.FORBIDDEN,
      HttpStatus.FORBIDDEN,
    );
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it('动态作者可以删除他人的评论并扣减一次计数', async () => {
    const { service, tx } = createContext();
    tx.momentComment.findFirst.mockResolvedValue({
      authorId: 'comment-author',
      deletedAt: null,
      mediaId: null,
      moment: { authorId: 'moment-owner', deletedAt: null },
    });

    await expect(service.remove('moment-1', 'comment-1', { id: 'moment-owner' })).resolves.toEqual({
      message: '评论已删除',
    });
    expect(tx.momentComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ removalSource: 'OWNER' }) }),
    );
    expect(tx.moment.updateMany).toHaveBeenCalledWith({
      where: { id: 'moment-1', deletedAt: null },
      data: { commentCount: { decrement: 1 } },
    });
  });
});
