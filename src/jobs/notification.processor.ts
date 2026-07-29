import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/** 通知队列消费者：处理回复、@提及、新楼层等通知 */
@Processor('notification')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { type, recipients, content, postId, threadId, fromUserId, payload } = job.data;

    switch (type) {
      case 'reply':
      case 'mention':
      case 'new_post':
      case 'thread_created':
      case 'follow':
      case 'system':
        await this.createNotifications(recipients, type, content, postId, threadId, fromUserId, payload);
        break;
      case 'like':
        await this.createOrUpdateLikeNotifications(recipients, content, threadId, fromUserId, payload);
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
    payload?: any,
  ) {
    for (const userId of userIds) {
      const existing = await this.prisma.notification.findFirst({
        where: { userId, type: 'like' as any, threadId, isRead: false },
      });

      if (existing) {
        // 聚合更新：累加计数、更新文案和 likers 列表
        const currentCount = ((existing.payload as any)?.totalCount ?? 1) + 1;
        const existingLikers: any[] = (existing.payload as any)?.likers ?? [];
        const newLiker = payload?.likers?.[0];
        const likers = newLiker && !existingLikers.some((l: any) => l.userId === newLiker.userId)
          ? [...existingLikers, newLiker].slice(-3) // 保留最近 3 人
          : existingLikers;

        const aggregatedContent = currentCount <= 2
          ? likers.map((l: any) => l.username).join('、') + ` 赞了你的主题帖`
          : `${likers[0]?.username ?? ''}、${likers[1]?.username ?? ''}等 ${currentCount} 人赞了你的主题帖`;

        await this.prisma.notification.update({
          where: { id: existing.id },
          data: {
            content: aggregatedContent,
            fromUserId, // 最近一位点赞者
            payload: { ...payload, likers, totalCount: currentCount },
            createdAt: new Date(), // 推送到列表顶部
          },
        });
        this.logger.log(`Aggregated like notification for user ${userId} (count: ${currentCount})`);
      } else {
        await this.prisma.notification.create({
          data: { userId, type: 'like' as any, content, threadId, fromUserId, payload },
        });
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
  ) {
    if (userIds.length === 0) return;

    const data = userIds.map((userId) => ({ userId, type: type as any, content, postId, threadId, fromUserId, payload }));

    // 防止 BullMQ retry 时重复插入：过滤已存在记录，不整批跳过
    const dedupWhere: any = { userId: { in: userIds }, type: type as any, postId, threadId };
    if (fromUserId !== undefined) {
      dedupWhere.fromUserId = fromUserId;
    }
    const existing = await this.prisma.notification.findMany({
      where: dedupWhere,
      select: { userId: true },
    });
    if (existing.length > 0) {
      const existingIds = new Set(existing.map(n => n.userId));
      const newIds = userIds.filter(id => !existingIds.has(id));
      if (newIds.length === 0) {
        this.logger.warn(`All ${userIds.length} notifications of type '${type}' already exist (retry guard)`);
        return;
      }
      await this.prisma.notification.createMany({
        data: newIds.map((userId) => ({ userId, type: type as any, content, postId, threadId, fromUserId, payload })),
      });
      this.logger.log(`Created ${newIds.length} notifications of type '${type}' (${existing.length} duplicates skipped)`);
      return;
    }

    await this.prisma.notification.createMany({ data });
    this.logger.log(`Created ${userIds.length} notifications of type '${type}'`);
  }
}
