import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageQueryService } from './direct-message-query.service';
import { StickersService } from '../stickers/stickers.service';

const createdAt = new Date('2026-08-06T20:00:00.000Z');

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
    get: jest.fn((key: string) => ({
      'directMessages.sendRatePerMinute': 30,
      'directMessages.requestRatePerDay': 10,
    })[key]),
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
  let service: DirectMessagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.userFollow.count.mockResolvedValue(0);
    prisma.directMessage.findUnique.mockResolvedValue(null);
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
    );
  });

  it('非互关用户发起私聊时创建待处理请求和唯一首条消息', async () => {
    prisma.directConversation.findUnique.mockResolvedValue(null);
    prisma.directConversation.create.mockResolvedValue({ id: 'c1' });

    await expect(service.initiate('u1', {
      recipientId: 'u2',
      content: '你好',
      clientRequestId: '99454040-6a52-4bf3-8bad-42683c4d09be',
    })).resolves.toEqual({
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

    await service.handleRequest('c1', { id: 'u2', emailVerified: true }, 'DECLINE');

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

    expect(stickers.assertFavorite).toHaveBeenCalledWith(
      'u1',
      'cm1234567890123456789012',
      prisma,
    );
    expect(stickers.recordUsage).toHaveBeenCalledWith(
      'u1',
      'cm1234567890123456789012',
      prisma,
    );
    expect(prisma.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: null,
        mediaId: null,
        stickerAssetId: 'cm1234567890123456789012',
      }),
    }));
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
});
