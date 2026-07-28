import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/paginated-result';

/** 站内通知服务：CRUD、未读数、硬删除、标记未读 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** 获取用户通知列表（支持按类型过滤，自动排除已软删帖/子贴） */
  async findAll(userId: string, cursor?: string, limit = 20, types?: string[]) {
    const take = Math.min(limit, 50);
    const where: any = {
      userId,
      // 过滤已被软删的主题帖和帖子的通知
      OR: [
        { AND: [{ threadId: null }, { postId: null }] },
        { threadId: { not: null }, thread: { deletedAt: null } },
        { postId: { not: null }, post: { deletedAt: null } },
      ],
    };
    if (types && types.length > 0) {
      where.type = { in: types as any[] };
    }
    const notifs = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        post: { select: { id: true, floorNumber: true, parentPostId: true } },
        thread: { select: { id: true, title: true } },
        fromUser: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });

    const hasMore = notifs.length > take;
    if (hasMore) notifs.pop();

    return paginate(notifs, {
      cursor: notifs.length > 0 ? notifs[notifs.length - 1].id : null,
      hasMore,
    });
  }

  /** 创建通知 */
  async create(userId: string, type: string, content: string, opts?: { postId?: string; threadId?: string; fromUserId?: string }) {
    return this.prisma.notification.create({
      data: { userId, type: type as any, content, ...opts },
    });
  }

  async createMany(notifications: { userId: string; type: string; content: string; postId?: string; threadId?: string; fromUserId?: string }[]) {
    if (notifications.length === 0) return;
    await this.prisma.notification.createMany({
      data: notifications.map(n => ({ ...n, type: n.type as any })),
    });
  }

  /** 获取未读数 */
  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /** 标记为已读 */
  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  /** 设置阅读状态（支持标记未读） */
  async setReadStatus(id: string, userId: string, isRead: boolean) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead },
    });
  }

  /** 全部已读 */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  /** 硬删除单条通知 */
  async remove(id: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id, userId },
    });
  }
}
