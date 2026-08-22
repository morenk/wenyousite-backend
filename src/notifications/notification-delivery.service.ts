import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobilePushProducer } from '../mobile-push/mobile-push.producer';
import type { NotificationJob } from './notification.producer';

interface LikeLiker {
  userId: string;
  username: string;
}
interface LikePayload {
  action?: string;
  actorName?: string;
  threadTitle?: string;
  totalCount?: number;
  likers?: LikeLiker[];
  /** 最近处理过的点赞事件，用于 Outbox 至少一次重放幂等。 */
  eventKeys?: string[];
  [key: string]: unknown;
}

function asLikePayload(value: unknown): LikePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const { likers, eventKeys, ...rest } = value as LikePayload;
  return {
    ...rest,
    ...(Array.isArray(likers) ? { likers: likers.filter(isLikeLiker) } : {}),
    ...(Array.isArray(eventKeys)
      ? { eventKeys: eventKeys.filter((key): key is string => typeof key === 'string') }
      : {}),
  };
}

function isLikeLiker(value: unknown): value is LikeLiker {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as LikeLiker).userId === 'string' &&
    typeof (value as LikeLiker).username === 'string',
  );
}

/** 通知投递服务：先将权威通知幂等写入 PostgreSQL，再尽力提交移动推送。 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private readonly pushes: MobilePushProducer,
  ) {}

  async deliver(job: NotificationJob): Promise<void> {
    const {
      type,
      recipients,
      content,
      postId,
      threadId,
      momentId,
      momentCommentId,
      fromUserId,
      payload,
      eventKey,
      campaignId,
    } = job;

    switch (type) {
      case 'reply':
      case 'mention':
      case 'new_post':
      case 'thread_created':
      case 'follow':
      case 'tip':
      case 'level_up':
      case 'system':
        await this.createNotifications(
          recipients,
          type,
          content,
          postId,
          threadId,
          momentId,
          momentCommentId,
          fromUserId,
          payload,
          eventKey,
          campaignId,
        );
        break;
      case 'like':
        await this.createOrUpdateLikeNotifications(
          recipients,
          content,
          threadId,
          fromUserId,
          payload,
          eventKey,
        );
        break;
      default:
        throw new Error(`Unsupported notification type: ${String(type)}`);
    }
  }

  /** 点赞通知聚合：未读则更新，已读或不存在则新建 */
  private async createOrUpdateLikeNotifications(
    userIds: string[],
    content: string,
    threadId?: string,
    fromUserId?: string,
    payload?: unknown,
    eventKey?: string,
  ) {
    for (const userId of userIds) {
      await this.aggregateLikeForUser(userId, content, threadId, fromUserId, payload, eventKey);
    }
  }

  /**
   * 点赞聚合必须在数据库事务中完成，否则两个并发点赞可能同时读到同一条旧通知，
   * 最终丢失一次计数。Serializable 冲突由投递服务在本地重试事务。
   */
  private async aggregateLikeForUser(
    userId: string,
    content: string,
    threadId?: string,
    fromUserId?: string,
    payload?: unknown,
    eventKey?: string,
  ) {
    const likePayload = asLikePayload(payload);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const pushTarget = await this.prisma.$transaction(
          async (tx) => {
            const notifications = await tx.notification.findMany({
              where: { userId, type: NotificationType.like, threadId },
              orderBy: { createdAt: 'desc' },
              select: { id: true, isRead: true, payload: true },
            });

            // Outbox 确认丢失时，重放不能再次累加同一个点赞事件。
            const processed = eventKey
              ? notifications.find((notification) =>
                  asLikePayload(notification.payload).eventKeys?.includes(eventKey),
                )
              : undefined;
            if (processed) {
              return { notificationId: processed.id, eventKey };
            }

            const existing = notifications.find((notification) => !notification.isRead);
            if (existing) {
              const existingPayload = asLikePayload(existing.payload);
              const existingLikers = (existingPayload.likers ?? []).filter(isLikeLiker);
              const newLiker = (likePayload.likers ?? []).find(isLikeLiker);
              const likers =
                newLiker && !existingLikers.some((liker) => liker.userId === newLiker.userId)
                  ? [...existingLikers, newLiker].slice(-3)
                  : existingLikers;
              const currentCount =
                typeof existingPayload.totalCount === 'number' && existingPayload.totalCount > 0
                  ? existingPayload.totalCount
                  : Math.max(existingLikers.length, 1);
              const totalCount = currentCount + 1;
              const title = likePayload.threadTitle ?? existingPayload.threadTitle;
              const topicLabel = title ? `主题帖「${title}」` : '主题帖';
              const names = likers.map((liker) => liker.username).filter(Boolean);
              const fallbackName = newLiker?.username ?? likePayload.actorName ?? '有人';
              const aggregatedContent =
                totalCount <= 2
                  ? `${names.join('、') || fallbackName} 赞了你的${topicLabel}`
                  : `${names[0] ?? fallbackName}、${names[1] ?? ''}等 ${totalCount} 人赞了你的${topicLabel}`;
              const eventKeys = eventKey
                ? [...new Set([...(existingPayload.eventKeys ?? []), eventKey])].slice(-100)
                : existingPayload.eventKeys;
              const aggregatedPayload = {
                ...existingPayload,
                ...likePayload,
                likers,
                totalCount,
                ...(eventKeys ? { eventKeys } : {}),
              } as unknown as Prisma.InputJsonValue;

              await tx.notification.update({
                where: { id: existing.id },
                data: {
                  content: aggregatedContent,
                  fromUserId,
                  payload: aggregatedPayload,
                  createdAt: new Date(),
                },
              });
              this.logger.log(
                `Aggregated like notification for user ${userId} (count: ${totalCount})`,
              );
              return { notificationId: existing.id, eventKey: eventKey ?? `like:${existing.id}` };
            }

            const created = await tx.notification.create({
              data: {
                userId,
                type: NotificationType.like,
                content,
                threadId,
                fromUserId,
                payload: eventKey
                  ? ({ ...likePayload, eventKeys: [eventKey] } as unknown as Prisma.InputJsonValue)
                  : payload == null
                    ? Prisma.JsonNull
                    : (payload as Prisma.InputJsonValue),
              },
              select: { id: true, eventKey: true },
            });
            return { notificationId: created.id, eventKey: eventKey ?? created.eventKey };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (pushTarget)
          await this.enqueuePush(
            userId,
            pushTarget.notificationId,
            `notification:${pushTarget.eventKey}:${userId}`,
          );
        return;
      } catch (error: unknown) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code !== 'P2034' || attempt === 2) throw error;
        this.logger.warn(`Retrying concurrent like aggregation for user ${userId}`);
      }
    }
  }

  private async createNotifications(
    userIds: string[],
    type: NotificationType,
    content: string,
    postId?: string,
    threadId?: string,
    momentId?: string,
    momentCommentId?: string,
    fromUserId?: string,
    payload?: Record<string, unknown> | null,
    eventKey?: string,
    campaignId?: string,
  ) {
    if (userIds.length === 0) return;
    const startedAt = new Date();

    const data: Prisma.NotificationCreateManyInput[] = userIds.map((userId) => ({
      userId,
      type,
      content,
      campaignId,
      postId,
      threadId,
      momentId,
      momentCommentId,
      fromUserId,
      payload: payload == null ? Prisma.JsonNull : (payload as Prisma.InputJsonValue),
      ...(eventKey ? { eventKey: `${eventKey}:${userId}` } : {}),
    }));

    // 防止 Outbox 重放时重复插入：过滤已存在记录，不整批跳过。
    const dedupWhere: Prisma.NotificationWhereInput = eventKey
      ? { OR: userIds.map((userId) => ({ userId, eventKey: `${eventKey}:${userId}` })) }
      : { userId: { in: userIds }, type, postId, threadId, momentId, momentCommentId };
    if (!eventKey && fromUserId !== undefined) dedupWhere.fromUserId = fromUserId;
    const existing = await this.prisma.notification.findMany({
      where: dedupWhere,
      select: { id: true, userId: true, eventKey: true },
    });
    let newData = data;
    if (existing.length > 0) {
      const existingKeys = new Set(existing.map((n) => (eventKey ? n.eventKey : n.userId)));
      newData = data.filter(
        (item) => !existingKeys.has(eventKey ? (item.eventKey ?? '') : item.userId),
      );
      if (newData.length === 0) {
        this.logger.warn(
          `All ${userIds.length} notifications of type '${type}' already exist (retry guard)`,
        );
        if (!eventKey) return;
      }
    }

    if (newData.length > 0) {
      await this.prisma.notification.createMany({ data: newData, skipDuplicates: true });
    }
    const stored = await this.prisma.notification.findMany({
      where: eventKey
        ? { OR: data.map((item) => ({ userId: item.userId, eventKey: item.eventKey })) }
        : {
            userId: { in: newData.map((item) => item.userId) },
            type,
            postId,
            threadId,
            momentId,
            momentCommentId,
            createdAt: { gte: startedAt },
            ...(fromUserId !== undefined ? { fromUserId } : {}),
          },
      select: { id: true, userId: true, eventKey: true },
    });
    await Promise.all(
      stored.map((notification) =>
        this.enqueuePush(
          notification.userId,
          notification.id,
          `notification:${notification.eventKey ?? notification.id}`,
        ),
      ),
    );
    this.logger.log(
      `Created ${newData.length} notifications of type '${type}' (${existing.length} duplicates skipped)`,
    );
  }

  private async enqueuePush(userId: string, notificationId: string, eventKey: string) {
    try {
      await this.pushes.enqueue({
        userId,
        kind: 'notification',
        eventKey,
        notificationId,
      });
    } catch (error: unknown) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'enqueue_failed';
      this.logger.warn(
        `Mobile push enqueue skipped notificationId=${notificationId} errorCode=${errorCode}`,
      );
    }
  }
}
