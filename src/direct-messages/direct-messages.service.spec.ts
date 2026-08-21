import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageQueryService } from './direct-message-query.service';
import { StickersService } from '../stickers/stickers.service';
import { DirectMessageEventsService } from './direct-message-events.service';

const createdAt = new Date('2026-08-06T20:00:00.000Z');
const requestId = '99454040-6a52-4bf3-8bad-42683c4d09be';

function uniqueConflict(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.14.0',
    meta: { target },
  });
}

function routingConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    firstUserId: 'u1',
    secondUserId: 'u2',
    requesterId: 'u1',
    recipientId: 'u2',
    status: 'PENDING',
    ...overrides,
  };
}

describe('DirectMessagesService', () => {
  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    userBlock: { findFirst: jest.fn() },
    userFollow: { count: jest.fn() },
    media: { findUnique: jest.fn() },
    directConversation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    directConversationParticipant: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    directMessage: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const redis = {
    hincrby: jest.fn(),
    expire: jest.fn(),
  };
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          'directMessages.sendRatePerMinute': 30,
          'directMessages.requestRatePerDay': 10,
        })[key],
    ),
  };
  const queries = {
    findById: jest.fn(),
    findMessageForUser: jest.fn(),
    assertParticipant: jest.fn(),
  };
  const stickers = {
    assertFavorite: jest.fn(),
    recordUsage: jest.fn(),
  };
  const events = { created: jest.fn() };
  const mediaReferences = { reconcileMediaIds: jest.fn() };
  let service: DirectMessagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.userFollow.count.mockResolvedValue(0);
    prisma.directMessage.findUnique.mockResolvedValue(null);
    prisma.directMessage.findMany.mockResolvedValue([]);
    prisma.directConversationParticipant.updateMany.mockResolvedValue({ count: 2 });
    prisma.directMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.directMessage.deleteMany.mockResolvedValue({ count: 1 });
    prisma.directConversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.directConversation.update.mockResolvedValue({});
    prisma.directMessage.create.mockResolvedValue({ id: 'm1', createdAt });
    redis.hincrby.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    queries.findById.mockResolvedValue({ id: 'c1', status: 'PENDING' });
    queries.findMessageForUser.mockResolvedValue({ id: 'm1' });
    service = new DirectMessagesService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
      queries as unknown as DirectMessageQueryService,
      stickers as unknown as StickersService,
      events as unknown as DirectMessageEventsService,
      mediaReferences as never,
    );
  });

  it('非互关用户发起私聊时创建待处理请求和唯一首条消息', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(null);
    prisma.directConversation.create.mockResolvedValue({ id: 'c1' });

    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '你好',
        clientRequestId: '99454040-6a52-4bf3-8bad-42683c4d09be',
      }),
    ).resolves.toEqual({
      conversation: { id: 'c1', status: 'PENDING' },
      message: { id: 'm1' },
    });

    expect(prisma.directConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firstUserId: 'u1',
        secondUserId: 'u2',
        requesterId: 'u1',
        recipientId: 'u2',
        status: 'PENDING',
        participants: { create: [{ userId: 'u1' }, { userId: 'u2' }] },
      }),
      select: { id: true },
    });
    expect(redis.hincrby).toHaveBeenCalledWith(
      'direct-messages:requests-day:u1',
      expect.any(String),
      1,
    );
  });

  it('互关用户发起私聊时直接建立已接受会话', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(null);
    prisma.directConversation.create.mockResolvedValue({ id: 'c1' });
    prisma.userFollow.count.mockResolvedValue(2);
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });

    await service.initiate('u1', {
      recipientId: 'u2',
      content: '你好',
      clientRequestId: '99454040-6a52-4bf3-8bad-42683c4d09be',
    });

    expect(prisma.directConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED' }),
      }),
    );
    expect(redis.hincrby).not.toHaveBeenCalledWith(
      'direct-messages:requests-day:u1',
      expect.any(String),
      1,
    );
  });

  it('待处理请求的接收方主动回复时接受会话并标记首条消息已读', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation());
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });

    await service.initiate('u2', {
      recipientId: 'u1',
      content: '可以聊聊',
      clientRequestId: '3af69fe1-826e-4777-83fb-5ecec0b3a2ed',
    });

    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'PENDING' },
      data: { status: 'ACCEPTED', requesterId: 'u2', recipientId: 'u1' },
    });
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1', recipientId: 'u2', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('接收方拒绝请求时删除请求消息并保留拒绝状态', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation());
    queries.findById.mockResolvedValue({ id: 'c1', status: 'DECLINED' });

    await service.handleRequest('c1', { id: 'u2' }, 'DECLINE');

    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'PENDING', recipientId: 'u2' },
      data: { status: 'DECLINED', lastMessageAt: null },
    });
    expect(prisma.directMessage.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
    });
  });

  it('撤回已接受会话中的图片消息时保留撤回占位并解除媒体关联', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      recipientId: 'u2',
      content: null,
      mediaId: 'media1',
      recalledAt: null,
      createdAt: new Date(),
      conversation: routingConversation({ status: 'ACCEPTED' }),
    });
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );

    await expect(service.recall('m1', 'u1')).resolves.toEqual({
      message: '消息已撤回',
      conversationCanceled: false,
    });
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', senderId: 'u1', recalledAt: null },
      data: { content: null, mediaId: null, stickerAssetId: null, recalledAt: expect.any(Date) },
    });
  });

  it('表情消息只写资产引用并在同一事务记录最近使用', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );

    await service.send('c1', 'u1', {
      stickerAssetId: 'cm1234567890123456789012',
      clientRequestId: '99454040-6a52-4bf3-8bad-42683c4d09be',
    });

    expect(stickers.assertFavorite).toHaveBeenCalledWith('u1', 'cm1234567890123456789012', prisma);
    expect(stickers.recordUsage).toHaveBeenCalledWith('u1', 'cm1234567890123456789012', prisma);
    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: null,
          mediaId: null,
          stickerAssetId: 'cm1234567890123456789012',
        }),
      }),
    );
  });

  it('超过十分钟的消息不能撤回', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      recalledAt: null,
      createdAt: new Date(Date.now() - 10 * 60 * 1000 - 1),
      conversation: routingConversation({ status: 'ACCEPTED' }),
    });

    await expect(service.recall('m1', 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_RECALL_EXPIRED,
    });
  });

  it('发起会话重试使用已有消息，且幂等键不能跨接收方复用', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'm-existing',
      conversationId: 'c-existing',
      recipientId: 'u2',
    });
    queries.findById.mockResolvedValue({ id: 'c-existing' });
    queries.findMessageForUser.mockResolvedValue({ id: 'm-existing' });

    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '重试',
        clientRequestId: requestId,
      }),
    ).resolves.toEqual({
      conversation: { id: 'c-existing' },
      message: { id: 'm-existing' },
    });
    expect(prisma.directConversation.findUnique).not.toHaveBeenCalled();

    await expect(
      service.initiate('u1', {
        recipientId: 'u3',
        content: '错误复用',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE });
  });

  it('拒绝给自己、已注销用户或任一方向拉黑的用户发起私聊', async () => {
    await expect(
      service.initiate('u1', {
        recipientId: 'u1',
        content: '自己',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE });

    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.initiate('u1', {
        recipientId: 'missing',
        content: '不存在',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.USER_NOT_FOUND });

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2' });
    prisma.userBlock.findFirst.mockResolvedValueOnce({ id: 'block-1' });
    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '已拉黑',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_MESSAGE_BLOCKED });
  });

  it('陌生请求和普通消息分别执行每日、每分钟限流', async () => {
    prisma.directConversation.findUnique.mockResolvedValueOnce(null);
    redis.hincrby.mockResolvedValueOnce(11);

    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '超过请求上限',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RATE_LIMITED });
    expect(redis.expire).toHaveBeenCalledWith('direct-messages:requests-day:u1', 172800);

    jest.clearAllMocks();
    prisma.directMessage.findUnique.mockResolvedValue(null);
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );
    redis.hincrby.mockResolvedValueOnce(31);
    redis.expire.mockResolvedValue(1);

    await expect(
      service.send('c1', 'u1', {
        content: '超过发送上限',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RATE_LIMITED });
    expect(redis.expire).toHaveBeenCalledWith('direct-messages:send-minute:u1', 120);
  });

  it.each([
    ['PENDING', ErrorCode.DIRECT_MESSAGE_REQUEST_PENDING],
    ['DECLINED', ErrorCode.DIRECT_MESSAGE_REQUEST_DECLINED],
    ['CANCELED', ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED],
  ])('状态为 %s 的会话拒绝继续发送', async (status, errorCode) => {
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation({ status }));

    await expect(
      service.send('c1', 'u1', {
        content: '不能发送',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode });
  });

  it('不向非参与者暴露会话是否存在', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );

    await expect(
      service.send('c1', 'outsider', {
        content: '越权',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_CONVERSATION_NOT_FOUND });
  });

  it('发送图片时校验归属与占用状态，并在成功后解除双方归档', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );
    prisma.media.findUnique.mockResolvedValue({
      userId: 'u1',
      status: 'COMPLETED',
      directMessage: null,
    });

    await service.send('c1', 'u1', {
      mediaId: 'media1',
      clientRequestId: requestId,
    });

    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: null, mediaId: 'media1', stickerAssetId: null }),
      }),
    );
    expect(prisma.directConversationParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1', archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    expect(events.created).toHaveBeenCalledWith(prisma, {
      messageId: 'm1',
      conversationId: 'c1',
      recipientId: 'u2',
    });

    prisma.directMessage.findUnique.mockResolvedValue(null);
    prisma.media.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.send('c1', 'u1', {
        mediaId: 'missing',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE });

    prisma.media.findUnique.mockResolvedValueOnce({
      userId: 'u1',
      status: 'COMPLETED',
      directMessage: { id: 'm-old' },
    });
    await expect(
      service.send('c1', 'u1', {
        mediaId: 'used',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_MESSAGE_MEDIA_ATTACHED });
  });

  it('并发发送命中幂等唯一索引时返回已落库消息', async () => {
    prisma.directMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'm-race', conversationId: 'c1', recipientId: 'u2' });
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );
    prisma.directMessage.create.mockRejectedValueOnce(
      uniqueConflict(['sender_id', 'client_request_id']),
    );
    queries.findMessageForUser.mockResolvedValue({ id: 'm-race' });

    await expect(
      service.send('c1', 'u1', {
        content: '并发重试',
        clientRequestId: requestId,
      }),
    ).resolves.toEqual({ id: 'm-race' });
  });

  it('已存在的发送幂等键只能用于原会话', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'm-existing',
      conversationId: 'other-conversation',
      recipientId: 'u2',
    });

    await expect(
      service.send('c1', 'u1', {
        content: '错误复用',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE });
    expect(prisma.directConversation.findUnique).not.toHaveBeenCalled();
  });

  it('新建会话并发冲突重试后返回并发请求已经落库的消息', async () => {
    prisma.directMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'm-race', conversationId: 'c1', recipientId: 'u2' });
    prisma.directConversation.findUnique.mockResolvedValue(null);
    prisma.directConversation.create.mockResolvedValue({ id: 'c1' });
    prisma.directMessage.create.mockRejectedValue(
      uniqueConflict(['sender_id', 'client_request_id']),
    );
    queries.findById.mockResolvedValue({ id: 'c1' });
    queries.findMessageForUser.mockResolvedValue({ id: 'm-race' });

    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '并发首条消息',
        clientRequestId: requestId,
      }),
    ).resolves.toEqual({
      conversation: { id: 'c1' },
      message: { id: 'm-race' },
    });
    expect(prisma.directConversation.create).toHaveBeenCalledTimes(2);
  });

  it('数据库媒体唯一索引冲突映射为稳定业务错误', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );
    prisma.media.findUnique.mockResolvedValue({
      userId: 'u1',
      status: 'COMPLETED',
      directMessage: null,
    });
    prisma.directMessage.create.mockRejectedValueOnce(uniqueConflict(['media_id']));

    await expect(
      service.send('c1', 'u1', {
        mediaId: 'media1',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_MESSAGE_MEDIA_ATTACHED });
  });

  it('待处理请求仅接收方可处理，并防止并发抢占', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation());

    await expect(service.handleRequest('c1', { id: 'u1' }, 'ACCEPT')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED,
    });

    prisma.directConversation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.handleRequest('c1', { id: 'u2' }, 'ACCEPT')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED,
    });
  });

  it('处理请求和撤回消息都不向非参与者暴露资源存在性', async () => {
    prisma.directConversation.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.handleRequest('missing', { id: 'outsider' }, 'DECLINE'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_CONVERSATION_NOT_FOUND });

    prisma.directMessage.findUnique.mockResolvedValueOnce(null);
    await expect(service.recall('missing', 'outsider')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_FOUND,
    });
  });

  it('接受请求时重查拉黑关系并把此前收到的消息标记已读', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation());
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });

    await service.handleRequest('c1', { id: 'u2' }, 'ACCEPT');

    expect(prisma.userBlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockerId: 'u2', blockedId: 'u1' },
            { blockerId: 'u1', blockedId: 'u2' },
          ],
        },
      }),
    );
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1', recipientId: 'u2', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('只有已接受会话和本人发出的待处理请求可以归档', async () => {
    prisma.directConversation.findFirst.mockResolvedValueOnce(
      routingConversation({ status: 'ACCEPTED' }),
    );
    await service.setArchived('c1', 'u1', true);
    expect(prisma.directConversationParticipant.update).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
      data: { archivedAt: expect.any(Date) },
    });

    prisma.directConversation.findFirst.mockResolvedValueOnce(routingConversation());
    await expect(service.setArchived('c1', 'u2', true)).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED,
    });

    prisma.directConversation.findFirst.mockResolvedValueOnce(null);
    await expect(service.setArchived('missing', 'u1', false)).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_CONVERSATION_NOT_FOUND,
    });
  });

  it('已读锚点必须属于当前会话，并使用时间与 ID 稳定边界更新', async () => {
    queries.assertParticipant.mockResolvedValue(undefined);
    prisma.directMessage.findUnique.mockResolvedValueOnce({
      id: 'm-anchor',
      conversationId: 'other',
      createdAt,
    });
    await expect(service.markRead('c1', 'u2', 'm-anchor')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_FOUND,
    });

    prisma.directMessage.findUnique.mockResolvedValueOnce({
      id: 'm-anchor',
      conversationId: 'c1',
      createdAt,
    });
    await expect(service.markRead('c1', 'u2', 'm-anchor')).resolves.toEqual({
      message: '已标记为已读',
    });
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'c1',
        recipientId: 'u2',
        readAt: null,
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lte: 'm-anchor' } }],
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it('撤回待处理首条消息会取消请求并删除消息', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      recalledAt: null,
      createdAt: new Date(),
      conversation: routingConversation(),
    });
    prisma.directConversation.findUnique.mockResolvedValue(routingConversation());

    await expect(service.recall('m1', 'u1')).resolves.toEqual({
      message: '消息请求已取消',
      conversationCanceled: true,
    });
    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'PENDING', requesterId: 'u1' },
      data: { status: 'CANCELED', lastMessageAt: null },
    });
    expect(prisma.directMessage.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
    });
  });

  it('撤回对非发送者隐藏消息，重复撤回保持幂等', async () => {
    prisma.directMessage.findUnique.mockResolvedValueOnce({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      recalledAt: null,
      createdAt: new Date(),
      conversation: routingConversation({ status: 'ACCEPTED' }),
    });
    await expect(service.recall('m1', 'u2')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED,
    });

    prisma.directMessage.findUnique.mockResolvedValueOnce({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      recalledAt: new Date(),
      createdAt: new Date(),
      conversation: routingConversation({ status: 'ACCEPTED' }),
    });
    await expect(service.recall('m1', 'u1')).resolves.toEqual({
      message: '消息已撤回',
      conversationCanceled: false,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('取消或拒绝后的会话允许原接收方重新联系', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'CANCELED' }),
    );
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });

    await service.initiate('u2', {
      recipientId: 'u1',
      content: '重新联系',
      clientRequestId: requestId,
    });

    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'CANCELED' },
      data: { status: 'ACCEPTED', requesterId: 'u2', recipientId: 'u1' },
    });
    expect(redis.hincrby).not.toHaveBeenCalledWith(
      'direct-messages:requests-day:u2',
      expect.any(String),
      1,
    );
  });

  it('既有已接受会话从用户主页发起时直接追加消息', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'ACCEPTED' }),
    );
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });

    await service.initiate('u1', {
      recipientId: 'u2',
      content: '继续聊天',
      clientRequestId: requestId,
    });

    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conversationId: 'c1', content: '继续聊天' }),
      }),
    );
  });

  it('已拒绝会话仅允许原接收方反向发起并直接接受', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'DECLINED' }),
    );

    await service.initiate('u2', {
      recipientId: 'u1',
      content: '由我重新联系',
      clientRequestId: requestId,
    });

    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'DECLINED' },
      data: { status: 'ACCEPTED', requesterId: 'u2', recipientId: 'u1' },
    });

    prisma.directMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.initiate('u1', {
        recipientId: 'u2',
        content: '原请求方重试',
        clientRequestId: requestId,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DIRECT_MESSAGE_REQUEST_DECLINED });
  });

  it('取消会话由原请求方重启时重新创建待处理请求', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'CANCELED' }),
    );

    await service.initiate('u1', {
      recipientId: 'u2',
      content: '再次申请',
      clientRequestId: requestId,
    });

    expect(redis.hincrby).toHaveBeenCalledWith(
      'direct-messages:requests-day:u1',
      expect.any(String),
      1,
    );
    expect(prisma.directConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'CANCELED' },
      data: { status: 'PENDING', requesterId: 'u1', recipientId: 'u2' },
    });
  });

  it('会话状态切换的并发幂等冲突返回已落库消息', async () => {
    prisma.directMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'm-race', conversationId: 'c1', recipientId: 'u1' });
    prisma.directConversation.findUnique.mockResolvedValue(
      routingConversation({ status: 'DECLINED' }),
    );
    prisma.directMessage.create.mockRejectedValueOnce(
      uniqueConflict(['sender_id', 'client_request_id']),
    );
    queries.findById.mockResolvedValue({ id: 'c1', status: 'ACCEPTED' });
    queries.findMessageForUser.mockResolvedValue({ id: 'm-race' });

    await expect(
      service.initiate('u2', {
        recipientId: 'u1',
        content: '并发重新联系',
        clientRequestId: requestId,
      }),
    ).resolves.toEqual({
      conversation: { id: 'c1', status: 'ACCEPTED' },
      message: { id: 'm-race' },
    });
  });
});
