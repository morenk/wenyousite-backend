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
    const { type, recipients, content, postId, threadId, fromUserId } = job.data;

    switch (type) {
      case 'reply':
      case 'mention':
      case 'new_floor':
      case 'thread_created':
      case 'follow':
        await this.createNotifications(recipients, type, content, postId, threadId, fromUserId);
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
  ) {
    if (userIds.length === 0) return;

    const data = userIds.map((userId) => ({ userId, type: type as any, content, postId, threadId, fromUserId }));
    await this.prisma.notification.createMany({ data });
    this.logger.log(`Created ${userIds.length} notifications of type '${type}'`);
  }
}
