import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';

/** 管理后台服务：系统通知发送 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly BROADCAST_BATCH_SIZE = 500;

  constructor(
    private prisma: PrismaService,
    private notificationProducer: NotificationProducer,
  ) {}

  /** 发送系统通知：指定用户或全站广播 */
  async sendSystemNotification(dto: SendSystemNotificationDto) {
    const { content, payload, recipientIds, threadId } = dto;

    if (recipientIds && recipientIds.length > 0) {
      const validUsers = await this.prisma.user.findMany({
        where: { id: { in: recipientIds }, deletedAt: null },
        select: { id: true },
      });
      const validIds = validUsers.map(u => u.id);
      if (validIds.length === 0) return { recipientCount: 0 };

      await this.notificationProducer.notify('system', validIds, content, {
        threadId,
        payload,
      });
      return { recipientCount: validIds.length };
    }

    // 全站广播：分批获取所有未注销用户
    let cursor: string | undefined;
    let totalCount = 0;
    let hasMore = true;

    while (hasMore) {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true },
        take: this.BROADCAST_BATCH_SIZE,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        orderBy: { id: 'asc' },
      });

      if (users.length === 0) {
        hasMore = false;
        break;
      }

      const batchIds = users.map(u => u.id);
      await this.notificationProducer.notify('system', batchIds, content, {
        threadId,
        payload,
      });

      totalCount += batchIds.length;
      hasMore = users.length === this.BROADCAST_BATCH_SIZE;
      cursor = users[users.length - 1].id;
    }

    this.logger.log(`Broadcast system notification to ${totalCount} users`);
    return { recipientCount: totalCount };
  }
}
