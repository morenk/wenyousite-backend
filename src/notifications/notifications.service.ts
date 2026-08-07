import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/paginated-result';
import { publicUserSummarySelect } from '../common/user-summary';

function normalizePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>), schemaVersion: 1 };
}

function notificationTarget(notification: {
  postId: string | null;
  threadId: string | null;
  fromUserId: string | null;
  type: string;
}) {
  if (notification.postId) {
    return {
      kind: 'post' as const,
      threadId: notification.threadId,
      postId: notification.postId,
      userId: null,
    };
  }
  if (notification.threadId) {
    return {
      kind: 'thread' as const,
      threadId: notification.threadId,
      postId: null,
      userId: null,
    };
  }
  if (notification.type === 'follow' && notification.fromUserId) {
    return {
      kind: 'user' as const,
      threadId: null,
      postId: null,
      userId: notification.fromUserId,
    };
  }
  return { kind: 'none' as const, threadId: null, postId: null, userId: null };
}

/** 站内通知服务：CRUD、未读数、硬删除、标记未读 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 通知只对仍然可见的目标生效：
   * - 没有关联目标的系统/关注通知始终可见；
   * - 只关联主题帖的通知要求主题帖未删除；
   * - 关联帖子的通知同时要求帖子、子贴和主题帖均未删除。
   *
   * 列表与未读数必须共用这组条件，否则会出现“角标有未读、列表却没有对应通知”。
   */
  private visibleWhere(userId: string, extra: Record<string, unknown> = {}) {
    return {
      ...extra,
      userId,
      AND: [
        {
          OR: [
            { postId: null, threadId: null },
            { postId: null, threadId: { not: null }, thread: { deletedAt: null } },
            {
              postId: { not: null },
              post: {
                deletedAt: null,
                thread: { deletedAt: null },
                subthread: { deletedAt: null },
              },
            },
          ],
        },
      ],
    };
  }

  /** 获取用户通知列表（支持按类型过滤，自动排除已软删帖/子贴） */
  async findAll(userId: string, cursor?: string, limit = 20, types?: string[]) {
    const take = Math.min(limit, 50);
    const where: any = this.visibleWhere(userId);
    if (types && types.length > 0) {
      const aliases = types.flatMap((type) =>
        type === 'new_post' ? ['new_post', 'new_floor', 'subthread_created'] : [type],
      );
      where.type = { in: [...new Set(aliases)] as any[] };
    }
    const notifs = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        post: { select: { id: true, floorNumber: true, parentPostId: true, deletedAt: true } },
        thread: { select: { id: true, title: true, deletedAt: true } },
        fromUser: { select: publicUserSummarySelect },
      },
    });

    const hasMore = notifs.length > take;
    if (hasMore) notifs.pop();

    // 兼容迁移前已经写入的旧类型，避免前端需要同时维护两套类型分支。
    const normalizedNotifs = notifs.map((notification) => {
      const normalizedType =
        notification.type === 'new_floor' || notification.type === 'subthread_created'
          ? 'new_post'
          : notification.type;
      return {
        ...notification,
        type: normalizedType,
        payload: normalizePayload(notification.payload),
        target: notificationTarget({ ...notification, type: normalizedType }),
      };
    });

    return paginate(normalizedNotifs, {
      cursor: normalizedNotifs.length > 0 ? normalizedNotifs[normalizedNotifs.length - 1].id : null,
      hasMore,
    });
  }

  /** 创建通知 */
  async create(
    userId: string,
    type: string,
    content: string,
    opts?: { postId?: string; threadId?: string; fromUserId?: string },
  ) {
    return this.prisma.notification.create({
      data: { userId, type: type as any, content, ...opts },
    });
  }

  async createMany(
    notifications: {
      userId: string;
      type: string;
      content: string;
      postId?: string;
      threadId?: string;
      fromUserId?: string;
    }[],
  ) {
    if (notifications.length === 0) return;
    await this.prisma.notification.createMany({
      data: notifications.map((n) => ({ ...n, type: n.type as any })),
    });
  }

  /** 获取未读数 */
  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: this.visibleWhere(userId, { isRead: false }),
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
      where: this.visibleWhere(userId, { isRead: false }),
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
