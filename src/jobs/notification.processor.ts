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
      case 'like':
      case 'system':
        await this.createNotifications(recipients, type, content, postId, threadId, fromUserId, payload);
        break;
      default:
        this.logger.warn(`Unknown notification type: ${type}`);
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
