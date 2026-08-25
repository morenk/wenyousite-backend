import { Injectable } from '@nestjs/common';
import { ContentRemovalSource, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/paginated-result';
import { publicUserSummarySelect } from '../common/user-summary';

export const NOTIFICATION_TARGET_STATES = [
  'ACTIVE',
  'CONTENT_DELETED',
  'USER_DEACTIVATED',
  'NO_TARGET',
] as const;
export type NotificationTargetState = (typeof NOTIFICATION_TARGET_STATES)[number];

const CONTENT_NOTIFICATION_TYPES: NotificationType[] = [
  'reply',
  'mention',
  'new_floor',
  'subthread_created',
  'new_post',
  'thread_created',
  'like',
];

function normalizePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>), schemaVersion: 1 };
}

interface LoadedNotificationTarget {
  postId?: string | null;
  threadId?: string | null;
  momentId?: string | null;
  momentCommentId?: string | null;
  fromUserId?: string | null;
  type: string;
  post?: {
    deletedAt: Date | null;
    parentPost?: { deletedAt: Date | null } | null;
    subthread?: { deletedAt: Date | null } | null;
    thread?: { deletedAt: Date | null } | null;
  } | null;
  thread?: { deletedAt: Date | null } | null;
  moment?: { deletedAt: Date | null } | null;
  momentComment?: {
    deletedAt: Date | null;
    parentComment?: {
      deletedAt: Date | null;
      removalSource: ContentRemovalSource | null;
    } | null;
  } | null;
  fromUser?: { deletedAt: Date | null } | null;
}

function notificationTargetState(notification: LoadedNotificationTarget): NotificationTargetState {
  if (notification.momentId) {
    if (!notification.moment || notification.moment.deletedAt) return 'CONTENT_DELETED';
    if (notification.momentCommentId) {
      const comment = notification.momentComment;
      if (
        !comment ||
        comment.deletedAt ||
        (comment.parentComment?.deletedAt &&
          comment.parentComment.removalSource === ContentRemovalSource.ADMIN)
      ) {
        return 'CONTENT_DELETED';
      }
    }
    return 'ACTIVE';
  }

  if (notification.postId) {
    if (
      !notification.post ||
      notification.post.deletedAt ||
      notification.post.parentPost?.deletedAt ||
      notification.post.subthread?.deletedAt ||
      notification.post.thread?.deletedAt
    ) {
      return 'CONTENT_DELETED';
    }
    return 'ACTIVE';
  }

  if (notification.threadId) {
    return notification.thread && !notification.thread.deletedAt ? 'ACTIVE' : 'CONTENT_DELETED';
  }

  if ((notification.type === 'follow' || notification.type === 'tip') && notification.fromUserId) {
    return notification.fromUser?.deletedAt ? 'USER_DEACTIVATED' : 'ACTIVE';
  }

  if (CONTENT_NOTIFICATION_TYPES.includes(notification.type as NotificationType)) {
    return 'CONTENT_DELETED';
  }
  return 'NO_TARGET';
}

function notificationTarget(
  notification: LoadedNotificationTarget,
  state: NotificationTargetState,
) {
  if (state !== 'ACTIVE') {
    return {
      kind: 'none' as const,
      state,
      threadId: null,
      postId: null,
      momentId: null,
      momentCommentId: null,
      userId: null,
    };
  }
  if (notification.momentId) {
    return {
      kind: 'moment' as const,
      state,
      threadId: null,
      postId: null,
      momentId: notification.momentId,
      momentCommentId: notification.momentCommentId ?? null,
      userId: null,
    };
  }
  if (notification.postId) {
    return {
      kind: 'post' as const,
      state,
      threadId: notification.threadId ?? null,
      postId: notification.postId,
      momentId: null,
      momentCommentId: null,
      userId: null,
    };
  }
  if (notification.threadId) {
    return {
      kind: 'thread' as const,
      state,
      threadId: notification.threadId,
      postId: null,
      momentId: null,
      momentCommentId: null,
      userId: null,
    };
  }
  return {
    kind: 'user' as const,
    state,
    threadId: null,
    postId: null,
    momentId: null,
    momentCommentId: null,
    userId: notification.fromUserId ?? null,
  };
}

/** 站内通知服务：保留历史、隔离私密目标，并统一删除态与未读语义。 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** 历史列表保留删除目标，但只允许仍有权获知对应私密主题的用户读取。 */
  private historyWhere(
    userId: string,
    extra: Prisma.NotificationWhereInput = {},
  ): Prisma.NotificationWhereInput {
    return {
      userId,
      AND: [
        extra,
        {
          OR: [
            { threadId: null, postId: null },
            { thread: { published: true, visibility: 'PUBLIC' } },
            {
              thread: {
                published: true,
                visibility: 'PRIVATE',
                members: { some: { userId } },
              },
            },
            { thread: { published: false, ownerId: userId } },
            { post: { thread: { published: true, visibility: 'PUBLIC' } } },
            {
              post: {
                thread: {
                  published: true,
                  visibility: 'PRIVATE',
                  members: { some: { userId } },
                },
              },
            },
            { post: { thread: { published: false, ownerId: userId } } },
          ],
        },
      ],
    };
  }

  /** 只有当前仍可导航的目标（以及真正无目标的系统通知）可以计入未读或被标回未读。 */
  private unreadEligibleWhere(
    userId: string,
    extra: Prisma.NotificationWhereInput = {},
  ): Prisma.NotificationWhereInput {
    return {
      AND: [
        this.historyWhere(userId, extra),
        {
          OR: [
            {
              momentId: { not: null },
              momentCommentId: null,
              moment: { deletedAt: null },
            },
            {
              momentId: { not: null },
              momentCommentId: { not: null },
              moment: { deletedAt: null },
              momentComment: {
                deletedAt: null,
                OR: [
                  { parentCommentId: null },
                  { parentComment: { deletedAt: null } },
                  {
                    parentComment: {
                      deletedAt: { not: null },
                      removalSource: { not: ContentRemovalSource.ADMIN },
                    },
                  },
                ],
              },
            },
            { postId: null, threadId: { not: null }, thread: { deletedAt: null } },
            {
              postId: { not: null },
              post: {
                deletedAt: null,
                thread: { deletedAt: null },
                subthread: { deletedAt: null },
                OR: [{ parentPostId: null }, { parentPost: { deletedAt: null } }],
              },
            },
            {
              postId: null,
              threadId: null,
              momentId: null,
              type: { in: ['follow', 'tip'] },
              fromUserId: { not: null },
              fromUser: { deletedAt: null },
            },
            {
              postId: null,
              threadId: null,
              momentId: null,
              type: { in: ['level_up', 'system'] },
            },
          ],
        },
      ],
    };
  }

  /** 获取用户通知列表；删除目标保留为不可跳转、已读的历史记录。 */
  async findAll(userId: string, cursor?: string, limit = 20, types?: string[]) {
    const take = Math.min(limit, 50);
    const where = this.historyWhere(userId);
    if (types && types.length > 0) {
      const aliases = types.flatMap((type): NotificationType[] => {
        if (type === 'new_post') return ['new_post', 'new_floor', 'subthread_created'];
        return Object.values(NotificationType).includes(type as NotificationType)
          ? [type as NotificationType]
          : [];
      });
      where.type = { in: [...new Set(aliases)] };
    }
    const notifs = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        post: {
          select: {
            id: true,
            floorNumber: true,
            parentPostId: true,
            deletedAt: true,
            parentPost: { select: { deletedAt: true } },
            subthread: { select: { deletedAt: true } },
            thread: { select: { deletedAt: true } },
          },
        },
        thread: { select: { id: true, title: true, deletedAt: true } },
        moment: { select: { id: true, title: true, deletedAt: true } },
        momentComment: {
          select: {
            id: true,
            parentCommentId: true,
            deletedAt: true,
            parentComment: { select: { deletedAt: true, removalSource: true } },
          },
        },
        fromUser: { select: publicUserSummarySelect },
      },
    });

    const hasMore = notifs.length > take;
    if (hasMore) notifs.pop();

    const invalidIds: string[] = [];
    const normalizedNotifs = notifs.map((notification) => {
      const normalizedType =
        notification.type === 'new_floor' || notification.type === 'subthread_created'
          ? 'new_post'
          : notification.type;
      const state = notificationTargetState({ ...notification, type: normalizedType });
      const unavailable = state === 'CONTENT_DELETED' || state === 'USER_DEACTIVATED';
      if (unavailable && !notification.isRead) invalidIds.push(notification.id);
      return {
        ...notification,
        type: normalizedType,
        payload: normalizePayload(notification.payload),
        post: notification.post
          ? {
              id: notification.post.id,
              floorNumber: notification.post.floorNumber,
              parentPostId: notification.post.parentPostId,
              deletedAt: notification.post.deletedAt,
            }
          : null,
        momentComment: notification.momentComment
          ? {
              id: notification.momentComment.id,
              parentCommentId: notification.momentComment.parentCommentId,
              deletedAt: notification.momentComment.deletedAt,
            }
          : null,
        postId: unavailable ? null : notification.postId,
        threadId: unavailable ? null : notification.threadId,
        momentId: unavailable ? null : notification.momentId,
        momentCommentId: unavailable ? null : notification.momentCommentId,
        fromUserId: state === 'USER_DEACTIVATED' ? null : notification.fromUserId,
        isRead: notification.isRead || unavailable,
        target: notificationTarget({ ...notification, type: normalizedType }, state),
      };
    });

    if (invalidIds.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: invalidIds }, userId, isRead: false },
        data: { isRead: true },
      });
    }

    return paginate(normalizedNotifs, {
      cursor: normalizedNotifs.length > 0 ? normalizedNotifs[normalizedNotifs.length - 1].id : null,
      hasMore,
    });
  }

  /** 创建通知 */
  async create(
    userId: string,
    type: NotificationType,
    content: string,
    opts?: {
      postId?: string;
      threadId?: string;
      momentId?: string;
      momentCommentId?: string;
      fromUserId?: string;
    },
  ) {
    return this.prisma.notification.create({
      data: { userId, type, content, ...opts },
    });
  }

  async createMany(
    notifications: {
      userId: string;
      type: NotificationType;
      content: string;
      postId?: string;
      threadId?: string;
      momentId?: string;
      momentCommentId?: string;
      fromUserId?: string;
    }[],
  ) {
    if (notifications.length === 0) return;
    await this.prisma.notification.createMany({ data: notifications });
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: this.unreadEligibleWhere(userId, { isRead: false }),
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.setReadStatus(id, userId, true);
  }

  async setReadStatus(id: string, userId: string, isRead: boolean) {
    return this.prisma.notification.updateMany({
      where: isRead ? this.historyWhere(userId, { id }) : this.unreadEligibleWhere(userId, { id }),
      data: { isRead },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: this.historyWhere(userId, { isRead: false }),
      data: { isRead: true },
    });
  }

  /** 用户主动删除自己的通知记录仍为硬删除，不影响内容与审计账本。 */
  async remove(id: string, userId: string) {
    return this.prisma.notification.deleteMany({ where: { id, userId } });
  }
}
