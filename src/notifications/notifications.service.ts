import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 站内通知服务：CRUD、未读数 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** 获取用户通知列表（含关联的帖子/主题/发信人信息，供前端拼接跳转 URL） */
  async findAll(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50);
    const notifs = await this.prisma.notification.findMany({
      where: { userId },
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

    return {
      items: notifs,
      pagination: { cursor: notifs.length > 0 ? notifs[notifs.length - 1].id : null, hasMore },
    };
  }

  /** 创建通知 */
  async create(userId: string, type: string, content: string, opts?: { postId?: string; threadId?: string; fromUserId?: string }) {
    return this.prisma.notification.create({
      data: { userId, type, content, ...opts },
    });
  }

  async createMany(notifications: { userId: string; type: string; content: string; postId?: string; threadId?: string; fromUserId?: string }[]) {
    if (notifications.length === 0) return;
    await this.prisma.notification.createMany({
      data: notifications,
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

  /** 全部已读 */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
