import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';

/** 管理后台服务：系统通知发送、预览、历史、用户搜索 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly BROADCAST_BATCH_SIZE = 500;

  constructor(
    private prisma: PrismaService,
    private notificationProducer: NotificationProducer,
  ) {}

  /** 根据 DTO 构建接收者查询条件 */
  buildRecipientWhere(dto: SendSystemNotificationDto) {
    if (dto.recipientIds?.length) {
      return { id: { in: dto.recipientIds }, deletedAt: null };
    }

    const where: any = { deletedAt: null };

    if (dto.conditions) {
      const c = dto.conditions;
      if (c.role?.length) where.role = { in: c.role };
      if (c.emailVerified !== undefined) where.emailVerified = c.emailVerified;
      if (c.createdAfter) where.createdAt = { ...where.createdAt, gte: new Date(c.createdAfter) };
      if (c.createdBefore) where.createdAt = { ...where.createdAt, lte: new Date(c.createdBefore) };
    }

    return where;
  }

  /** 预览接收者人数（不发送） */
  async previewRecipients(dto: SendSystemNotificationDto) {
    const where = this.buildRecipientWhere(dto);
    const count = await this.prisma.user.count({ where });
    return { recipientCount: count };
  }

  /** 发送系统通知：手动指定 / 条件筛选 / 全站广播，写入审计日志 */
  async sendSystemNotification(dto: SendSystemNotificationDto, adminId: string, ip?: string) {
    const { content, payload, threadId } = dto;
    const where = this.buildRecipientWhere(dto);

    // 先统计总数用于审计
    const totalCount = await this.prisma.user.count({ where });
    if (totalCount === 0) return { recipientCount: 0 };
    const eventKey = `system:${adminId}:${randomUUID()}`;

    // 分批获取用户 ID 并入队
    let cursor: string | undefined;
    let sentCount = 0;
    let hasMore = true;

    while (hasMore) {
      const users = await this.prisma.user.findMany({
        where,
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

      const batchIds = users.map((u) => u.id);
      await this.notificationProducer.notify('system', batchIds, content, {
        threadId,
        payload,
        eventKey,
      });

      sentCount += batchIds.length;
      hasMore = users.length === this.BROADCAST_BATCH_SIZE;
      cursor = users[users.length - 1].id;
    }

    // 审计日志
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'SYSTEM_NOTIFICATION',
        targetType: 'USER',
        detail: JSON.stringify({
          content: content.slice(0, 200),
          recipientCount: sentCount,
          conditions: dto.conditions ?? null,
        }),
        ip: ip ?? null,
      },
    });

    this.logger.log(`Admin ${adminId} sent system notification to ${sentCount} users`);
    return { recipientCount: sentCount, estimatedCount: totalCount };
  }

  /** 系统通知历史（cursor 分页） */
  async getSystemNotificationHistory(cursor?: string, limit = 20) {
    const take = Math.min(limit, 50);
    const where: any = { type: 'system' };
    const notifications = await this.prisma.notification.findMany({
      where,
      select: {
        id: true,
        userId: true,
        content: true,
        payload: true,
        threadId: true,
        isRead: true,
        createdAt: true,
        user: { select: { id: true, username: true, deletedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });

    const hasMore = notifications.length > take;
    if (hasMore) notifications.pop();

    return {
      data: notifications,
      cursor: notifications.length > 0 ? notifications[notifications.length - 1].id : null,
      hasMore,
    };
  }

  /** 用户搜索（供管理员手动选择接收者） */
  async searchUsers(query: string, limit = 20) {
    const take = Math.min(limit, 50);
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
      take,
      orderBy: { createdAt: 'desc' },
    });
    return { data: users };
  }
}
