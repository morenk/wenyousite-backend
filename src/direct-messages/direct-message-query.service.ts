import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DirectConversationQueryDto, DirectMessageQueryDto } from './dto/direct-conversation-query.dto';
import {
  canonicalDirectUserPair,
  directConversationInclude,
  directMessageSelect,
  mapDirectConversation,
  mapDirectMessage,
} from './direct-message-mapper';

@Injectable()
export class DirectMessageQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, query: DirectConversationQueryDto) {
    const participantFilter = query.view === 'ARCHIVED'
      ? { userId, archivedAt: { not: null } }
      : { userId, archivedAt: null };
    const statusFilter: Prisma.DirectConversationWhereInput = query.view === 'REQUESTS'
      ? { status: 'PENDING', recipientId: userId }
      : {
          OR: [
            { status: 'ACCEPTED' },
            { status: 'PENDING', requesterId: userId },
          ],
        };
    const take = Math.min(query.limit ?? 20, 50);

    const conversations = await this.prisma.directConversation.findMany({
      where: {
        ...statusFilter,
        participants: { some: participantFilter },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: directConversationInclude(userId),
    });

    const hasMore = conversations.length > take;
    if (hasMore) conversations.pop();
    const blockedIds = await this.loadBlockedOtherUserIds(userId, conversations);
    const items = conversations.map((conversation) => {
      const otherId = conversation.firstUserId === userId
        ? conversation.secondUserId
        : conversation.firstUserId;
      return mapDirectConversation(conversation, userId, blockedIds.has(otherId));
    });

    return paginate(items, {
      cursor: items.at(-1)?.id ?? null,
      hasMore,
    });
  }

  async findById(id: string, userId: string) {
    const conversation = await this.prisma.directConversation.findFirst({
      where: { id, participants: { some: { userId } } },
      include: directConversationInclude(userId),
    });
    if (!conversation) throw this.conversationNotFound();

    const otherId = conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
    const blocked = await this.hasBlock(userId, otherId);
    return mapDirectConversation(conversation, userId, blocked);
  }

  async findByOtherUser(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BusinessException(
        ErrorCode.INVALID_DIRECT_MESSAGE,
        '不能给自己发送私聊',
        HttpStatus.BAD_REQUEST,
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: otherUserId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');

    const pair = canonicalDirectUserPair(userId, otherUserId);
    const conversation = await this.prisma.directConversation.findUnique({
      where: { firstUserId_secondUserId: pair },
      include: directConversationInclude(userId),
    });
    const blocked = await this.hasBlock(userId, otherUserId);
    if (!conversation) {
      return {
        contactState: blocked ? 'UNAVAILABLE' : 'NEW',
        canInitiate: !blocked,
        conversation: null,
      };
    }

    const mapped = mapDirectConversation(conversation, userId, blocked);
    const canInitiate = !blocked && (
      conversation.status === 'ACCEPTED'
      || conversation.status === 'CANCELED'
      || (conversation.status === 'DECLINED' && conversation.recipientId === userId)
    );
    return {
      contactState: blocked ? 'UNAVAILABLE' : conversation.status,
      canInitiate,
      conversation: mapped,
    };
  }

  async findMessages(conversationId: string, userId: string, query: DirectMessageQueryDto) {
    await this.assertParticipant(conversationId, userId);
    if (query.cursor && query.after) {
      throw new BusinessException(
        ErrorCode.INVALID_DIRECT_MESSAGE,
        'cursor 与 after 不能同时使用',
        HttpStatus.BAD_REQUEST,
      );
    }

    const anchorId = query.cursor ?? query.after;
    const anchor = anchorId
      ? await this.prisma.directMessage.findUnique({
          where: { id: anchorId },
          select: { id: true, conversationId: true, createdAt: true },
        })
      : null;
    if (anchorId && (!anchor || anchor.conversationId !== conversationId)) {
      throw notFound(ErrorCode.DIRECT_MESSAGE_NOT_FOUND, '私聊消息不存在');
    }

    const take = Math.min(query.limit ?? 30, 50);
    const boundary: Prisma.DirectMessageWhereInput = anchor
      ? query.after
        ? {
            OR: [
              { createdAt: { gt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { gt: anchor.id } },
            ],
          }
        : {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          }
      : {};
    const ascending = Boolean(query.after);
    const messages = await this.prisma.directMessage.findMany({
      where: { conversationId, ...boundary },
      orderBy: [
        { createdAt: ascending ? 'asc' : 'desc' },
        { id: ascending ? 'asc' : 'desc' },
      ],
      take: take + 1,
      select: directMessageSelect,
    });

    const hasMore = messages.length > take;
    if (hasMore) messages.pop();
    if (!ascending) messages.reverse();
    const items = messages.map(mapDirectMessage);

    return paginate(items, {
      cursor: ascending ? items.at(-1)?.id ?? null : items[0]?.id ?? null,
      hasMore,
    });
  }

  async unreadCount(userId: string) {
    const [unreadMessageCount, pendingRequestCount] = await Promise.all([
      this.prisma.directMessage.count({
        where: {
          recipientId: userId,
          readAt: null,
          conversation: { status: 'ACCEPTED' },
        },
      }),
      this.prisma.directConversation.count({
        where: { status: 'PENDING', recipientId: userId },
      }),
    ]);
    return {
      unreadMessageCount,
      pendingRequestCount,
      total: unreadMessageCount + pendingRequestCount,
    };
  }

  async findMessageForUser(messageId: string, userId: string) {
    const message = await this.prisma.directMessage.findFirst({
      where: {
        id: messageId,
        conversation: { participants: { some: { userId } } },
      },
      select: directMessageSelect,
    });
    if (!message) throw notFound(ErrorCode.DIRECT_MESSAGE_NOT_FOUND, '私聊消息不存在');
    return mapDirectMessage(message);
  }

  async assertParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.directConversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });
    if (!participant) throw this.conversationNotFound();
  }

  private conversationNotFound() {
    return notFound(ErrorCode.DIRECT_CONVERSATION_NOT_FOUND, '私聊会话不存在');
  }

  private async hasBlock(userId: string, otherUserId: string) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherUserId },
          { blockerId: otherUserId, blockedId: userId },
        ],
      },
      select: { id: true },
    });
    return Boolean(block);
  }

  private async loadBlockedOtherUserIds(
    userId: string,
    conversations: Array<{ firstUserId: string; secondUserId: string }>,
  ) {
    const otherIds = conversations.map((conversation) =>
      conversation.firstUserId === userId
        ? conversation.secondUserId
        : conversation.firstUserId,
    );
    if (otherIds.length === 0) return new Set<string>();

    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: otherIds } },
          { blockedId: userId, blockerId: { in: otherIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(blocks.map((block) =>
      block.blockerId === userId ? block.blockedId : block.blockerId,
    ));
  }
}
