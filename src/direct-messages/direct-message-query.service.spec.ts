import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  DirectConversationQueryDto,
  DirectMessageQueryDto,
} from './dto/direct-conversation-query.dto';
import { DirectMessageQueryService } from './direct-message-query.service';

const createdAt = new Date('2026-08-06T20:00:00.000Z');

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    firstUserId: 'user-1',
    secondUserId: 'user-2',
    requesterId: 'user-1',
    recipientId: 'user-2',
    status: 'PENDING',
    firstUser: {
      id: 'user-1',
      username: '甲',
      avatar: null,
      deletedAt: null,
    },
    secondUser: {
      id: 'user-2',
      username: '乙',
      avatar: null,
      deletedAt: null,
    },
    participants: [{ archivedAt: null }],
    messages: [{
      id: 'message-latest',
      senderId: 'user-1',
      content: '你好',
      mediaId: null,
      stickerAssetId: null,
      recalledAt: null,
      createdAt,
    }],
    _count: { messages: 2 },
    lastMessageAt: createdAt,
    createdAt,
    ...overrides,
  };
}

function message(id: string, date: Date = createdAt) {
  return {
    id,
    conversationId: 'conversation-1',
    senderId: 'user-1',
    recipientId: 'user-2',
    content: id,
    recalledAt: null,
    createdAt: date,
    media: null,
    sticker: null,
  };
}

describe('DirectMessageQueryService', () => {
  const prisma = {
    directConversation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    directConversationParticipant: { findUnique: jest.fn() },
    directMessage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    userBlock: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  let service: DirectMessageQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.directConversationParticipant.findUnique.mockResolvedValue({ id: 'participant-1' });
    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.userBlock.findMany.mockResolvedValue([]);
    service = new DirectMessageQueryService(prisma as unknown as PrismaService);
  });

  it('请求箱按接收方过滤、执行游标分页并标记双向拉黑', async () => {
    prisma.directConversation.findMany.mockResolvedValue([
      conversation(),
      conversation({ id: 'conversation-extra' }),
    ]);
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'user-1', blockedId: 'user-2' },
    ]);

    const result = await service.findAll('user-1', {
      view: 'REQUESTS',
      cursor: 'conversation-before',
      limit: 1,
    } as DirectConversationQueryDto);

    expect(prisma.directConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'PENDING',
        recipientId: 'user-1',
        participants: { some: { userId: 'user-1', archivedAt: null } },
      },
      take: 2,
      cursor: { id: 'conversation-before' },
      skip: 1,
    }));
    expect(result.pagination).toEqual({ cursor: 'conversation-1', hasMore: true });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'conversation-1',
      isBlocked: true,
      canSend: false,
    }));
  });

  it('归档箱只查询当前用户已归档的会话', async () => {
    prisma.directConversation.findMany.mockResolvedValue([]);

    await service.findAll('user-1', {
      view: 'ARCHIVED',
      limit: 20,
    } as DirectConversationQueryDto);

    expect(prisma.directConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        participants: { some: { userId: 'user-1', archivedAt: { not: null } } },
      }),
    }));
    expect(prisma.userBlock.findMany).not.toHaveBeenCalled();
  });

  it('按 ID 查询时隐藏不属于当前用户的会话', async () => {
    prisma.directConversation.findFirst.mockResolvedValue(null);

    await expect(service.findById('conversation-1', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_CONVERSATION_NOT_FOUND,
    });
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
  });

  it('按 ID 查询时根据双向拉黑关闭发送能力', async () => {
    prisma.directConversation.findFirst.mockResolvedValue(conversation({ status: 'ACCEPTED' }));
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block-1' });

    await expect(service.findById('conversation-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ isBlocked: true, canSend: false }),
    );
    expect(prisma.userBlock.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerId: 'user-1', blockedId: 'user-2' },
          { blockerId: 'user-2', blockedId: 'user-1' },
        ],
      },
      select: { id: true },
    });
  });

  it('拒绝查询与自己的私聊且不访问数据库', async () => {
    await expect(service.findByOtherUser('user-1', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_DIRECT_MESSAGE,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('目标用户不存在时返回业务 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.findByOtherUser('user-1', 'missing')).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
  });

  it('无既有会话时区分可发起和被拉黑状态', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    prisma.directConversation.findUnique.mockResolvedValue(null);

    await expect(service.findByOtherUser('user-1', 'user-2')).resolves.toEqual({
      contactState: 'NEW',
      canInitiate: true,
      conversation: null,
    });

    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block-1' });
    await expect(service.findByOtherUser('user-1', 'user-2')).resolves.toEqual({
      contactState: 'UNAVAILABLE',
      canInitiate: false,
      conversation: null,
    });
  });

  it('接收方可以重新发起已拒绝的既有会话', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    prisma.directConversation.findUnique.mockResolvedValue(conversation({
      status: 'DECLINED',
      recipientId: 'user-1',
    }));

    await expect(service.findByOtherUser('user-1', 'user-2')).resolves.toEqual(
      expect.objectContaining({
        contactState: 'DECLINED',
        canInitiate: true,
        conversation: expect.objectContaining({ id: 'conversation-1' }),
      }),
    );
  });

  it('cursor 与 after 同时出现时在读取锚点前拒绝', async () => {
    await expect(service.findMessages('conversation-1', 'user-1', {
      cursor: 'message-1',
      after: 'message-2',
    } as DirectMessageQueryDto)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_DIRECT_MESSAGE,
    });
    expect(prisma.directMessage.findUnique).not.toHaveBeenCalled();
  });

  it('分页锚点不存在或属于其他会话时返回无效游标', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'message-1',
      conversationId: 'other-conversation',
      createdAt,
    });

    await expect(service.findMessages('conversation-1', 'user-1', {
      cursor: 'message-1',
    } as DirectMessageQueryDto)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_CURSOR,
    });
  });

  it('向前翻页使用稳定的时间和 ID 边界并恢复时间正序', async () => {
    const anchorTime = new Date('2026-08-06T21:00:00.000Z');
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'message-anchor',
      conversationId: 'conversation-1',
      createdAt: anchorTime,
    });
    prisma.directMessage.findMany.mockResolvedValue([
      message('message-3'),
      message('message-2'),
      message('message-extra'),
    ]);

    const result = await service.findMessages('conversation-1', 'user-1', {
      cursor: 'message-anchor',
      limit: 2,
    } as DirectMessageQueryDto);

    expect(prisma.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        conversationId: 'conversation-1',
        OR: [
          { createdAt: { lt: anchorTime } },
          { createdAt: anchorTime, id: { lt: 'message-anchor' } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }));
    expect(result.items.map((item) => item.id)).toEqual(['message-2', 'message-3']);
    expect(result.pagination).toEqual({ cursor: 'message-2', hasMore: true });
  });

  it('after 增量加载保持正序并以末条消息为下一游标', async () => {
    prisma.directMessage.findUnique.mockResolvedValue({
      id: 'message-anchor',
      conversationId: 'conversation-1',
      createdAt,
    });
    prisma.directMessage.findMany.mockResolvedValue([
      message('message-2'),
      message('message-3'),
    ]);

    const result = await service.findMessages('conversation-1', 'user-1', {
      after: 'message-anchor',
      limit: 2,
    } as DirectMessageQueryDto);

    expect(prisma.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
    expect(result.items.map((item) => item.id)).toEqual(['message-2', 'message-3']);
    expect(result.pagination).toEqual({ cursor: 'message-3', hasMore: false });
  });

  it('未读统计合并消息数和待处理请求数', async () => {
    prisma.directMessage.count.mockResolvedValue(4);
    prisma.directConversation.count.mockResolvedValue(2);

    await expect(service.unreadCount('user-1')).resolves.toEqual({
      unreadMessageCount: 4,
      pendingRequestCount: 2,
      total: 6,
    });
  });

  it('消息详情只向会话参与者返回', async () => {
    prisma.directMessage.findFirst.mockResolvedValue(null);

    await expect(service.findMessageForUser('message-1', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_MESSAGE_NOT_FOUND,
    });

    prisma.directMessage.findFirst.mockResolvedValue(message('message-1'));
    await expect(service.findMessageForUser('message-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ id: 'message-1', content: 'message-1' }),
    );
  });

  it('非参与者不能读取会话消息', async () => {
    prisma.directConversationParticipant.findUnique.mockResolvedValue(null);

    await expect(service.assertParticipant('conversation-1', 'outsider')).rejects.toMatchObject({
      errorCode: ErrorCode.DIRECT_CONVERSATION_NOT_FOUND,
    });
  });
});
