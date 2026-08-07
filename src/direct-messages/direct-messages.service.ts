import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, DirectConversationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CreateDirectConversationDto, CreateDirectMessageDto } from './dto/direct-message.dto';
import { DirectRequestAction } from './dto/direct-conversation-action.dto';
import { DirectConversationStartResponseDto } from './dto/direct-message-response.dto';
import {
  canonicalDirectUserPair,
  RoutingConversation,
  routingConversationSelect,
} from './direct-message-mapper';
import { DirectMessageQueryService } from './direct-message-query.service';
import { StickersService } from '../stickers/stickers.service';
import {
  NormalizedDirectMessageInput,
  normalizeDirectMessageInput,
} from './direct-message-input';
import { DirectMessageEventsService } from './direct-message-events.service';

const RECALL_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class DirectMessagesService {
  private readonly sendRatePerMinute: number;
  private readonly requestRatePerDay: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly queries: DirectMessageQueryService,
    private readonly stickers: StickersService,
    private readonly events: DirectMessageEventsService,
  ) {
    this.sendRatePerMinute = this.config.get<number>('directMessages.sendRatePerMinute') ?? 30;
    this.requestRatePerDay = this.config.get<number>('directMessages.requestRatePerDay') ?? 10;
  }

  async initiate(
    senderId: string,
    dto: CreateDirectConversationDto,
    retry = false,
  ): Promise<DirectConversationStartResponseDto> {
    const input = normalizeDirectMessageInput(dto);
    const duplicate = await this.findDuplicate(senderId, input.clientRequestId);
    if (duplicate) {
      if (duplicate.recipientId !== dto.recipientId) {
        throw this.invalidMessage('幂等键已用于其他接收方');
      }
      return this.startResponse(duplicate.conversationId, duplicate.id, senderId);
    }

    if (senderId === dto.recipientId) throw this.invalidMessage('不能给自己发送私聊');
    await this.assertActiveUser(dto.recipientId);
    await this.assertNotBlocked(senderId, dto.recipientId);

    const pair = canonicalDirectUserPair(senderId, dto.recipientId);
    const existing = await this.prisma.directConversation.findUnique({
      where: { firstUserId_secondUserId: pair },
      select: routingConversationSelect,
    });
    if (existing) return this.initiateExisting(existing, senderId, dto.recipientId, input);

    const accepted = await this.areMutualFollowers(senderId, dto.recipientId);
    if (!accepted) await this.assertRequestRate(senderId);
    await this.assertSendRate(senderId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.assertMediaAvailable(tx, senderId, input.mediaId);
        await this.assertStickerAvailable(tx, senderId, input.stickerAssetId);
        await this.assertPairWritable(tx, senderId, dto.recipientId);
        const conversation = await tx.directConversation.create({
          data: {
            ...pair,
            requesterId: senderId,
            recipientId: dto.recipientId,
            status: accepted ? 'ACCEPTED' : 'PENDING',
            participants: {
              create: [{ userId: senderId }, { userId: dto.recipientId }],
            },
          },
          select: { id: true },
        });
        const message = await this.createMessage(tx, conversation.id, senderId, dto.recipientId, input);
        await tx.directConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: message.createdAt },
        });
        return { conversationId: conversation.id, messageId: message.id };
      });
      return this.startResponse(created.conversationId, created.messageId, senderId);
    } catch (error) {
      if (this.isUniqueConflict(error, 'media_id')) throw this.mediaAttached();
      if (this.isUniqueConflict(error) && !retry) {
        return this.initiate(senderId, dto, true);
      }
      if (this.isUniqueConflict(error)) {
        const duplicateAfterRace = await this.findDuplicate(senderId, input.clientRequestId);
        if (duplicateAfterRace) {
          return this.startResponse(
            duplicateAfterRace.conversationId,
            duplicateAfterRace.id,
            senderId,
          );
        }
      }
      throw error;
    }
  }

  async send(conversationId: string, senderId: string, dto: CreateDirectMessageDto) {
    const input = normalizeDirectMessageInput(dto);
    const duplicate = await this.findDuplicate(senderId, input.clientRequestId);
    if (duplicate) {
      if (duplicate.conversationId !== conversationId) throw this.invalidMessage('幂等键已用于其他会话');
      return this.queries.findMessageForUser(duplicate.id, senderId);
    }

    const conversation = await this.prisma.directConversation.findUnique({
      where: { id: conversationId },
      select: routingConversationSelect,
    });
    if (!conversation || !this.isParticipant(conversation, senderId)) {
      throw this.conversationNotFound();
    }
    if (conversation.status !== 'ACCEPTED') {
      if (conversation.status === 'PENDING') throw this.requestPending();
      if (conversation.status === 'DECLINED') throw this.requestDeclined();
      throw this.notAllowed('该会话当前不能发送消息');
    }

    const recipientId = this.otherUserId(conversation, senderId);
    const messageId = await this.sendAccepted(conversation, senderId, recipientId, input);
    return this.queries.findMessageForUser(messageId, senderId);
  }

  async handleRequest(
    conversationId: string,
    actor: { id: string; emailVerified: boolean },
    action: DirectRequestAction,
  ) {
    const conversation = await this.prisma.directConversation.findUnique({
      where: { id: conversationId },
      select: routingConversationSelect,
    });
    if (!conversation || !this.isParticipant(conversation, actor.id)) {
      throw this.conversationNotFound();
    }
    if (conversation.status !== 'PENDING' || conversation.recipientId !== actor.id) {
      throw this.notAllowed('只有消息请求接收方可以处理该请求');
    }

    if (action === 'ACCEPT') {
      if (!actor.emailVerified) {
        throw new BusinessException(
          ErrorCode.EMAIL_NOT_VERIFIED,
          '请先验证邮箱后再接受私聊请求',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await this.assertPairWritable(tx, actor.id, conversation.requesterId);
        const claimed = await tx.directConversation.updateMany({
          where: { id: conversationId, status: 'PENDING', recipientId: actor.id },
          data: { status: 'ACCEPTED' },
        });
        if (claimed.count === 0) throw this.notAllowed('消息请求状态已变化');
        await tx.directMessage.updateMany({
          where: { conversationId, recipientId: actor.id, readAt: null },
          data: { readAt: new Date() },
        });
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.directConversation.updateMany({
          where: { id: conversationId, status: 'PENDING', recipientId: actor.id },
          data: { status: 'DECLINED', lastMessageAt: null },
        });
        if (claimed.count === 0) throw this.notAllowed('消息请求状态已变化');
        await tx.directMessage.deleteMany({ where: { conversationId } });
      });
    }
    return this.queries.findById(conversationId, actor.id);
  }

  async setArchived(conversationId: string, userId: string, archived: boolean) {
    const conversation = await this.prisma.directConversation.findFirst({
      where: { id: conversationId, participants: { some: { userId } } },
      select: routingConversationSelect,
    });
    if (!conversation) throw this.conversationNotFound();
    const canArchive = conversation.status === 'ACCEPTED'
      || (conversation.status === 'PENDING' && conversation.requesterId === userId);
    if (!canArchive) throw this.notAllowed('该会话当前不能归档');

    await this.prisma.directConversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt: archived ? new Date() : null },
    });
    return this.queries.findById(conversationId, userId);
  }

  async markRead(conversationId: string, userId: string, throughMessageId: string) {
    await this.queries.assertParticipant(conversationId, userId);
    const anchor = await this.prisma.directMessage.findUnique({
      where: { id: throughMessageId },
      select: { id: true, conversationId: true, createdAt: true },
    });
    if (!anchor || anchor.conversationId !== conversationId) {
      throw notFound(ErrorCode.DIRECT_MESSAGE_NOT_FOUND, '私聊消息不存在');
    }
    await this.prisma.directMessage.updateMany({
      where: {
        conversationId,
        recipientId: userId,
        readAt: null,
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lte: anchor.id } },
        ],
      },
      data: { readAt: new Date() },
    });
    return { message: '已标记为已读' };
  }

  async recall(messageId: string, senderId: string) {
    const message = await this.prisma.directMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: routingConversationSelect } },
    });
    if (!message || !this.isParticipant(message.conversation, senderId)) {
      throw notFound(ErrorCode.DIRECT_MESSAGE_NOT_FOUND, '私聊消息不存在');
    }
    if (message.senderId !== senderId) throw this.notAllowed('只能撤回自己发送的消息');
    if (message.recalledAt) return { message: '消息已撤回', conversationCanceled: false };
    if (Date.now() - message.createdAt.getTime() > RECALL_WINDOW_MS) {
      throw new BusinessException(
        ErrorCode.DIRECT_MESSAGE_RECALL_EXPIRED,
        '消息已超过 10 分钟撤回时限',
        HttpStatus.CONFLICT,
      );
    }

    const conversationCanceled = await this.prisma.$transaction(async (tx) => {
      const current = await tx.directConversation.findUnique({
        where: { id: message.conversationId },
        select: routingConversationSelect,
      });
      if (!current) throw this.conversationNotFound();
      if (current.status === 'PENDING' && current.requesterId === senderId) {
        const claimed = await tx.directConversation.updateMany({
          where: { id: current.id, status: 'PENDING', requesterId: senderId },
          data: { status: 'CANCELED', lastMessageAt: null },
        });
        if (claimed.count === 0) throw this.notAllowed('消息请求状态已变化');
        await tx.directMessage.deleteMany({ where: { conversationId: current.id } });
        return true;
      }
      if (current.status !== 'ACCEPTED') throw this.notAllowed('该消息当前不能撤回');
      const recalled = await tx.directMessage.updateMany({
        where: { id: messageId, senderId, recalledAt: null },
        data: { content: null, mediaId: null, stickerAssetId: null, recalledAt: new Date() },
      });
      if (recalled.count === 0) throw this.notAllowed('消息状态已变化');
      return false;
    });

    return {
      message: conversationCanceled ? '消息请求已取消' : '消息已撤回',
      conversationCanceled,
    };
  }

  private async initiateExisting(
    conversation: RoutingConversation,
    senderId: string,
    recipientId: string,
    input: NormalizedDirectMessageInput,
  ) {
    if (conversation.status === 'ACCEPTED') {
      const messageId = await this.sendAccepted(conversation, senderId, recipientId, input);
      return this.startResponse(conversation.id, messageId, senderId);
    }
    if (conversation.status === 'PENDING') {
      if (conversation.requesterId === senderId) throw this.requestPending();
      const messageId = await this.transitionAndSend(
        conversation,
        senderId,
        recipientId,
        input,
        'ACCEPTED',
        true,
      );
      return this.startResponse(conversation.id, messageId, senderId);
    }
    if (conversation.status === 'DECLINED') {
      if (conversation.requesterId === senderId) throw this.requestDeclined();
      const messageId = await this.transitionAndSend(
        conversation,
        senderId,
        recipientId,
        input,
        'ACCEPTED',
        false,
      );
      return this.startResponse(conversation.id, messageId, senderId);
    }

    const initiatedByFormerRecipient = conversation.recipientId === senderId;
    const accepted = initiatedByFormerRecipient
      || await this.areMutualFollowers(senderId, recipientId);
    if (!accepted) await this.assertRequestRate(senderId);
    const messageId = await this.transitionAndSend(
      conversation,
      senderId,
      recipientId,
      input,
      accepted ? 'ACCEPTED' : 'PENDING',
      false,
    );
    return this.startResponse(conversation.id, messageId, senderId);
  }

  private async sendAccepted(
    conversation: RoutingConversation,
    senderId: string,
    recipientId: string,
    input: NormalizedDirectMessageInput,
  ) {
    await this.assertSendRate(senderId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertMediaAvailable(tx, senderId, input.mediaId);
        await this.assertStickerAvailable(tx, senderId, input.stickerAssetId);
        await this.assertPairWritable(tx, senderId, recipientId);
        const current = await tx.directConversation.findUnique({
          where: { id: conversation.id },
          select: { status: true },
        });
        if (current?.status !== 'ACCEPTED') throw this.notAllowed('会话状态已变化');
        const message = await this.createMessage(tx, conversation.id, senderId, recipientId, input);
        await Promise.all([
          tx.directConversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: message.createdAt },
          }),
          tx.directConversationParticipant.updateMany({
            where: { conversationId: conversation.id, archivedAt: { not: null } },
            data: { archivedAt: null },
          }),
        ]);
        return message.id;
      });
    } catch (error) {
      if (this.isUniqueConflict(error, 'media_id')) throw this.mediaAttached();
      if (this.isUniqueConflict(error)) {
        const duplicate = await this.findDuplicate(senderId, input.clientRequestId);
        if (duplicate && duplicate.conversationId === conversation.id) return duplicate.id;
      }
      throw error;
    }
  }

  private async transitionAndSend(
    conversation: RoutingConversation,
    senderId: string,
    recipientId: string,
    input: NormalizedDirectMessageInput,
    nextStatus: DirectConversationStatus,
    markPreviousRead: boolean,
  ) {
    await this.assertSendRate(senderId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertMediaAvailable(tx, senderId, input.mediaId);
        await this.assertStickerAvailable(tx, senderId, input.stickerAssetId);
        await this.assertPairWritable(tx, senderId, recipientId);
        const transitioned = await tx.directConversation.updateMany({
          where: { id: conversation.id, status: conversation.status },
          data: {
            status: nextStatus,
            requesterId: senderId,
            recipientId,
          },
        });
        if (transitioned.count === 0) throw this.notAllowed('会话状态已变化');
        if (markPreviousRead) {
          await tx.directMessage.updateMany({
            where: { conversationId: conversation.id, recipientId: senderId, readAt: null },
            data: { readAt: new Date() },
          });
        }
        const message = await this.createMessage(tx, conversation.id, senderId, recipientId, input);
        await Promise.all([
          tx.directConversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: message.createdAt },
          }),
          tx.directConversationParticipant.updateMany({
            where: { conversationId: conversation.id },
            data: { archivedAt: null },
          }),
        ]);
        return message.id;
      });
    } catch (error) {
      if (this.isUniqueConflict(error, 'media_id')) throw this.mediaAttached();
      if (this.isUniqueConflict(error)) {
        const duplicate = await this.findDuplicate(senderId, input.clientRequestId);
        if (duplicate && duplicate.conversationId === conversation.id) return duplicate.id;
      }
      throw error;
    }
  }

  private async createMessage(
    tx: Prisma.TransactionClient,
    conversationId: string,
    senderId: string,
    recipientId: string,
    input: NormalizedDirectMessageInput,
  ) {
    const message = await tx.directMessage.create({
      data: {
        conversationId,
        senderId,
        recipientId,
        content: input.content,
        mediaId: input.mediaId,
        stickerAssetId: input.stickerAssetId,
        clientRequestId: input.clientRequestId,
      },
      select: { id: true, createdAt: true },
    });
    await this.events.created(tx, { messageId: message.id, conversationId, recipientId });
    return message;
  }

  private async startResponse(conversationId: string, messageId: string, userId: string) {
    const [conversation, message] = await Promise.all([
      this.queries.findById(conversationId, userId),
      this.queries.findMessageForUser(messageId, userId),
    ]);
    return { conversation, message };
  }

  private async assertStickerAvailable(
    tx: Prisma.TransactionClient,
    senderId: string,
    stickerAssetId: string | null,
  ) {
    if (!stickerAssetId) return;
    await this.stickers.assertFavorite(senderId, stickerAssetId, tx);
    await this.stickers.recordUsage(senderId, stickerAssetId, tx);
  }

  private async assertMediaAvailable(
    tx: Prisma.TransactionClient,
    senderId: string,
    mediaId: string | null,
  ) {
    if (!mediaId) return;
    const media = await tx.media.findUnique({
      where: { id: mediaId },
      select: { userId: true, status: true, directMessage: { select: { id: true } } },
    });
    if (!media || media.userId !== senderId || media.status !== 'COMPLETED') {
      throw this.invalidMessage('图片不存在、尚未处理完成或不属于当前用户');
    }
    if (media.directMessage) throw this.mediaAttached();
  }

  private async assertPairWritable(
    tx: Prisma.TransactionClient,
    userId: string,
    otherUserId: string,
  ) {
    const [target, block] = await Promise.all([
      tx.user.findUnique({
        where: { id: otherUserId, deletedAt: null },
        select: { id: true },
      }),
      tx.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: otherUserId },
            { blockerId: otherUserId, blockedId: userId },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!target) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (block) throw this.blocked();
  }

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
  }

  private async assertNotBlocked(userId: string, otherUserId: string) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherUserId },
          { blockerId: otherUserId, blockedId: userId },
        ],
      },
      select: { id: true },
    });
    if (block) throw this.blocked();
  }

  private async areMutualFollowers(userId: string, otherUserId: string) {
    const count = await this.prisma.userFollow.count({
      where: {
        OR: [
          { followerId: userId, followingId: otherUserId },
          { followerId: otherUserId, followingId: userId },
        ],
      },
    });
    return count === 2;
  }

  private async findDuplicate(senderId: string, clientRequestId: string) {
    return this.prisma.directMessage.findUnique({
      where: { senderId_clientRequestId: { senderId, clientRequestId } },
      select: { id: true, conversationId: true, recipientId: true },
    });
  }

  private async assertSendRate(userId: string) {
    const epoch = Math.floor(Date.now() / 60000);
    const key = `direct-messages:send-minute:${userId}`;
    const count = await this.redis.hincrby(key, String(epoch), 1);
    await this.redis.expire(key, 120);
    if (count > this.sendRatePerMinute) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '发送消息过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertRequestRate(userId: string) {
    const epoch = Math.floor(Date.now() / 86400000);
    const key = `direct-messages:requests-day:${userId}`;
    const count = await this.redis.hincrby(key, String(epoch), 1);
    await this.redis.expire(key, 172800);
    if (count > this.requestRatePerDay) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '今日发起的陌生消息请求已达上限',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private isParticipant(conversation: RoutingConversation, userId: string) {
    return conversation.firstUserId === userId || conversation.secondUserId === userId;
  }

  private otherUserId(conversation: RoutingConversation, userId: string) {
    return conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
  }

  private isUniqueConflict(error: unknown, target?: string) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    if (!target) return true;
    const fields = Array.isArray(error.meta?.target)
      ? error.meta.target.map(String)
      : [String(error.meta?.target ?? '')];
    return fields.some((field) => field.includes(target));
  }

  private invalidMessage(message: string) {
    return new BusinessException(
      ErrorCode.INVALID_DIRECT_MESSAGE,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  private blocked() {
    return new BusinessException(
      ErrorCode.DIRECT_MESSAGE_BLOCKED,
      '当前无法联系该用户',
      HttpStatus.FORBIDDEN,
    );
  }

  private notAllowed(message: string) {
    return new BusinessException(
      ErrorCode.DIRECT_MESSAGE_NOT_ALLOWED,
      message,
      HttpStatus.FORBIDDEN,
    );
  }

  private requestPending() {
    return new BusinessException(
      ErrorCode.DIRECT_MESSAGE_REQUEST_PENDING,
      '消息请求仍待对方处理，不能继续发送',
      HttpStatus.CONFLICT,
    );
  }

  private requestDeclined() {
    return new BusinessException(
      ErrorCode.DIRECT_MESSAGE_REQUEST_DECLINED,
      '对方已拒绝该消息请求',
      HttpStatus.CONFLICT,
    );
  }

  private mediaAttached() {
    return new BusinessException(
      ErrorCode.DIRECT_MESSAGE_MEDIA_ATTACHED,
      '该图片已用于其他私聊消息',
      HttpStatus.CONFLICT,
    );
  }

  private conversationNotFound() {
    return notFound(ErrorCode.DIRECT_CONVERSATION_NOT_FOUND, '私聊会话不存在');
  }
}
