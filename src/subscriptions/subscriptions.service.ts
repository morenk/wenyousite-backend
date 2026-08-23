import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma, SubscriptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { ThreadAccessService } from '../access/thread-access.service';
import { publishedThreadVisibilityWhere } from '../access/thread-visibility.where';

/** 订阅服务：玩家可订阅特定用户或整个主题帖 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
  ) {}

  /** 创建订阅 */
  async create(userId: string, threadId: string, type: SubscriptionType, targetUserId?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { id: true, published: true },
    });
    if (!thread?.published) {
      throw new BusinessException(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在', HttpStatus.NOT_FOUND);
    }

    const subscriberMember = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
      select: { role: true },
    });
    if (subscriberMember?.role === 'OWNER' || subscriberMember?.role === 'COLLABORATOR') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '管理者已自动接收帖子动态，无需订阅');
    }

    if (type === 'THREAD') {
      if (targetUserId !== undefined) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '订阅官方更新时不能指定用户');
      }
    } else {
      if (!targetUserId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '需要指定要订阅的玩家');
      }
      if (targetUserId === userId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能订阅自己');
      }
      const target = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId: targetUserId } },
        select: { role: true, playerMarked: true },
      });
      if (!target || target.role !== 'PARTICIPANT' || !target.playerMarked) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '只能订阅本帖中的普通玩家');
      }
    }

    const normalizedTargetUserId = type === 'USER' ? targetUserId : null;
    const existing = await this.prisma.subscription.findFirst({
      where: { userId, threadId, type, targetUserId: normalizedTargetUserId },
    });
    if (existing) {
      throw new BusinessException(ErrorCode.ALREADY_SUBSCRIBED, '已订阅', HttpStatus.CONFLICT);
    }

    return this.prisma.subscription
      .create({
        data: { userId, threadId, type, targetUserId: normalizedTargetUserId },
        include: { thread: { select: { id: true, title: true } } },
      })
      .catch((error) => {
        if (error?.code === 'P2002') {
          throw new BusinessException(ErrorCode.ALREADY_SUBSCRIBED, '已订阅', HttpStatus.CONFLICT);
        }
        throw error;
      });
  }

  /** 取消订阅 */
  async remove(id: string, userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) {
      throw notFound(ErrorCode.SUBSCRIPTION_NOT_FOUND, '订阅不存在');
    }
    return this.prisma.subscription.delete({ where: { id } });
  }

  /** 查看我的订阅列表 */
  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: {
        userId,
        thread: publishedThreadVisibilityWhere(userId),
      },
      include: {
        thread: { select: { id: true, title: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 获取某个主题帖的所有订阅者（含按用户筛选） */
  async findSubscribers(threadId: string, excludeUserId?: string, authorId?: string) {
    const where: Prisma.SubscriptionWhereInput = { threadId };
    if (excludeUserId) where.userId = { not: excludeUserId };
    if (authorId) {
      where.OR = [{ type: 'THREAD' }, { type: 'USER', targetUserId: authorId }];
    }
    return this.prisma.subscription.findMany({
      where,
      select: { userId: true, type: true, targetUserId: true },
    });
  }
}
