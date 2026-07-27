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
    const { type, recipients, content, referenceId } = job.data;

    switch (type) {
      case 'reply':
      case 'mention':
      case 'new_floor':
      case 'new_subthread':
        await this.createNotifications(recipients, type, content, referenceId);
        break;
      default:
        this.logger.warn(`Unknown notification type: ${type}`);
    }
  }

  private async createNotifications(
    userIds: string[],
    type: string,
    content: string,
    referenceId?: string,
  ) {
    if (userIds.length === 0) return;

    const data = userIds.map((userId) => ({ userId, type, content, referenceId }));
    await this.prisma.notification.createMany({ data });
    this.logger.log(`Created ${userIds.length} notifications of type '${type}'`);
  }
}
