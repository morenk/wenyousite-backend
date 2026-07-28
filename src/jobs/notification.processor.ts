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
      case 'new_floor':
      case 'subthread_created':
      case 'thread_created':
      case 'follow':
      case 'like':
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

    // 防止 BullMQ retry 时重复插入：若任意一条已存在则整批跳过
    const existing = await this.prisma.notification.findFirst({
      where: { userId: { in: userIds }, type: type as any, postId, threadId, fromUserId },
    });
    if (existing) {
      this.logger.warn(`Duplicate notifications of type '${type}' skipped (retry guard)`);
      return;
    }

    await this.prisma.notification.createMany({ data });
    this.logger.log(`Created ${userIds.length} notifications of type '${type}'`);
  }
}
