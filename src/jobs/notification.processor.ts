import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  /** 最近处理过的点赞事件，用于 BullMQ 重试幂等。 */
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

/** 通知队列消费者：处理回复、@提及、新楼层等通知 */
@Processor('notification')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { type, recipients, content, postId, threadId, fromUserId, payload, eventKey } = job.data;

    switch (type) {
      case 'reply':
      case 'mention':
      case 'new_post':
      case 'thread_created':
      case 'follow':
      case 'system':
        await this.createNotifications(
          recipients,
          type,
          content,
          postId,
          threadId,
          fromUserId,
          payload,
          eventKey,
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
        this.logger.warn(`Unknown notification type: ${type}`);
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
   * 最终丢失一次计数。Serializable 冲突由队列处理器在本地重试一次事务。
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
        await this.prisma.$transaction(
          async (tx) => {
            const notifications = await tx.notification.findMany({
              where: { userId, type: 'like' as any, threadId },
              orderBy: { createdAt: 'desc' },
              select: { id: true, isRead: true, payload: true },
            });

            // 处理器成功但 ACK 丢失时，重试不能再次累加同一个点赞事件。
            if (
              eventKey &&
              notifications.some((notification) =>
                asLikePayload(notification.payload).eventKeys?.includes(eventKey),
              )
            ) {
              return;
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
              return;
            }

            await tx.notification.create({
              data: {
                userId,
                type: 'like' as any,
                content,
                threadId,
                fromUserId,
                payload: eventKey
                  ? ({ ...likePayload, eventKeys: [eventKey] } as unknown as Prisma.InputJsonValue)
                  : payload == null
                    ? Prisma.JsonNull
                    : (payload as Prisma.InputJsonValue),
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
    type: string,
    content: string,
    postId?: string,
    threadId?: string,
    fromUserId?: string,
    payload?: any,
    eventKey?: string,
  ) {
    if (userIds.length === 0) return;

    const data = userIds.map((userId) => ({
      userId,
      type: type as any,
      content,
      postId,
      threadId,
      fromUserId,
      payload,
      ...(eventKey ? { eventKey: `${eventKey}:${userId}` } : {}),
    }));

    // 防止 BullMQ retry 时重复插入：过滤已存在记录，不整批跳过
    const dedupWhere: any = eventKey
      ? { OR: userIds.map((userId) => ({ userId, eventKey: `${eventKey}:${userId}` })) }
      : { userId: { in: userIds }, type: type as any, postId, threadId };
    if (!eventKey && fromUserId !== undefined) dedupWhere.fromUserId = fromUserId;
    const existing = await this.prisma.notification.findMany({
      where: dedupWhere,
      select: { userId: true, eventKey: true },
    });
    if (existing.length > 0) {
      const existingKeys = new Set(existing.map((n) => (eventKey ? n.eventKey : n.userId)));
      const newData = data.filter(
        (item) => !existingKeys.has(eventKey ? (item as any).eventKey : item.userId),
      );
      if (newData.length === 0) {
        this.logger.warn(
          `All ${userIds.length} notifications of type '${type}' already exist (retry guard)`,
        );
        return;
      }
      await this.prisma.notification.createMany({ data: newData as any, skipDuplicates: true });
      this.logger.log(
        `Created ${newData.length} notifications of type '${type}' (${existing.length} duplicates skipped)`,
      );
      return;
    }

    await this.prisma.notification.createMany({ data: data as any, skipDuplicates: true });
    this.logger.log(`Created ${userIds.length} notifications of type '${type}'`);
  }
}
