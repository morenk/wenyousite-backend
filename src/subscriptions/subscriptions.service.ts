import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 订阅服务：玩家可订阅特定用户或整个主题帖 */
@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  /** 创建订阅 */
  async create(userId: string, threadId: string, type: 'THREAD' | 'USER', targetUserId?: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('主题帖不存在');

    if (type === 'USER') {
      if (!targetUserId) throw new NotFoundException('需要指定要订阅的用户');
      const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) throw new NotFoundException('用户不存在');
    }

    const existing = await this.prisma.subscription.findUnique({
      where: { userId_threadId_targetUserId: { userId, threadId, targetUserId: targetUserId ?? '' } },
    });
    if (existing) throw new ConflictException('已订阅');

    return this.prisma.subscription.create({
      data: { userId, threadId, type, targetUserId },
      include: { thread: { select: { id: true, title: true } } },
    });
  }

  /** 取消订阅 */
  async remove(id: string, userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('订阅不存在');
    return this.prisma.subscription.delete({ where: { id } });
  }

  /** 查看我的订阅列表 */
  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: {
        thread: { select: { id: true, title: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 获取某个主题帖的所有订阅者（含按用户筛选） */
  async findSubscribers(threadId: string, excludeUserId?: string, authorId?: string) {
    const where: any = { threadId };
    if (excludeUserId) where.userId = { not: excludeUserId };
    if (authorId) {
      where.OR = [
        { type: 'THREAD' },
        { type: 'USER', targetUserId: authorId },
      ];
    }
    return this.prisma.subscription.findMany({
      where,
      select: { userId: true, type: true, targetUserId: true },
    });
  }
}
