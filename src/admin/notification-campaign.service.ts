import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AuditAction,
  AuditTargetType,
  NotificationCampaignStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from '../moderation/audit.service';
import { AdminActor } from '../moderation/admin-policy.service';
import { AdminRequestContext } from '../moderation/moderation.service';
import {
  CreateNotificationCampaignDto,
  NotificationAudienceDto,
  NotificationCampaignQueryDto,
} from './dto/notification-campaign.dto';

function conflict(message: string) {
  return new BusinessException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
}

const DISPATCH_BATCH_SIZE = 500;
const DISPATCH_LEASE_MS = 5 * 60_000;
const MAX_DISPATCH_ATTEMPTS = 10;

type InternalDispatchState = {
  dispatchCursor: unknown;
  dispatchAttempts: unknown;
  lastAttemptAt: unknown;
};

function withoutInternalDispatchState<T extends InternalDispatchState>(
  campaign: T,
): Omit<T, keyof InternalDispatchState> {
  const response = { ...campaign } as T & Partial<InternalDispatchState>;
  delete response.dispatchCursor;
  delete response.dispatchAttempts;
  delete response.lastAttemptAt;
  return response;
}

@Injectable()
export class NotificationCampaignService {
  private readonly logger = new Logger(NotificationCampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationProducer,
    private readonly audit: AuditService,
  ) {}

  async preview(audience: NotificationAudienceDto = {}) {
    return {
      recipientCount: await this.prisma.user.count({ where: this.audienceWhere(audience) }),
    };
  }

  async create(
    actor: AdminActor,
    dto: CreateNotificationCampaignDto,
    context: AdminRequestContext,
  ) {
    if (dto.destinationType && !dto.destinationId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '设置跳转目标时必须提供目标 ID');
    }
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt < new Date(Date.now() - 60_000)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '发送时间不能早于当前时间');
    }
    const audience = dto.audience ?? {};
    const estimatedCount = await this.prisma.user.count({ where: this.audienceWhere(audience) });
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.systemNotificationCampaign.create({
        data: {
          createdById: actor.id,
          title: dto.title.trim(),
          content: dto.content.trim(),
          scheduledAt,
          audience: audience as Prisma.InputJsonValue,
          destinationType: dto.destinationType,
          destinationId: dto.destinationId,
          estimatedCount,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.NOTIFICATION_CAMPAIGN_SCHEDULED,
          targetType: AuditTargetType.NOTIFICATION_CAMPAIGN,
          targetId: created.id,
          metadata: { scheduledAt: scheduledAt.toISOString(), estimatedCount },
          ...context,
        },
        tx,
      );
      return created;
    });
    return withoutInternalDispatchState(campaign);
  }

  async list(query: NotificationCampaignQueryDto) {
    const take = Math.min(query.limit ?? 20, 50);
    const keyword = query.q?.trim();
    const where: Prisma.SystemNotificationCampaignWhereInput = {
      status: query.status,
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { content: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.destination === 'THREAD' ? { destinationType: 'THREAD' } : {}),
      ...(query.destination === 'NONE' ? { destinationType: null } : {}),
    };
    const items = await this.prisma.systemNotificationCampaign.findMany({
      where,
      include: { createdBy: { select: { id: true, username: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = items.length > take;
    if (hasMore) items.pop();
    return paginate(items.map(withoutInternalDispatchState), {
      cursor: items.at(-1)?.id ?? null,
      hasMore,
    });
  }

  async cancel(id: string, actor: AdminActor, context: AdminRequestContext) {
    const current = await this.prisma.systemNotificationCampaign.findUnique({ where: { id } });
    if (!current) throw notFound(ErrorCode.NOT_FOUND, '通知计划不存在');
    if (current.status !== NotificationCampaignStatus.SCHEDULED) {
      throw conflict('只有待发送的通知计划可以取消');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.systemNotificationCampaign.update({
        where: { id },
        data: { status: NotificationCampaignStatus.CANCELED, canceledAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.NOTIFICATION_CAMPAIGN_CANCELED,
          targetType: AuditTargetType.NOTIFICATION_CAMPAIGN,
          targetId: id,
          ...context,
        },
        tx,
      );
    });
    return { message: '通知计划已取消' };
  }

  @Interval(30_000)
  async dispatchDueCampaigns() {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - DISPATCH_LEASE_MS);
    const due = await this.prisma.systemNotificationCampaign.findMany({
      where: {
        OR: [
          { status: NotificationCampaignStatus.SCHEDULED, scheduledAt: { lte: now } },
          {
            status: NotificationCampaignStatus.SENDING,
            OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: staleBefore } }],
            dispatchAttempts: { lt: MAX_DISPATCH_ATTEMPTS },
          },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    });
    for (const campaign of due) {
      try {
        await this.dispatch(campaign.id);
      } catch (error) {
        this.logger.error({ error, campaignId: campaign.id }, '定时站内通知发送失败');
        const message = error instanceof Error ? error.message : '队列投递失败';
        const terminal = await this.prisma.systemNotificationCampaign.updateMany({
          where: {
            id: campaign.id,
            status: NotificationCampaignStatus.SENDING,
            dispatchAttempts: { gte: MAX_DISPATCH_ATTEMPTS },
          },
          data: {
            status: NotificationCampaignStatus.FAILED,
            failureMessage: message.slice(0, 1000),
          },
        });
        if (terminal.count === 0) {
          await this.prisma.systemNotificationCampaign.updateMany({
            where: { id: campaign.id, status: NotificationCampaignStatus.SENDING },
            data: { failureMessage: message.slice(0, 1000) },
          });
        }
      }
    }
  }

  private async dispatch(id: string) {
    const now = new Date();
    let claimed = await this.prisma.systemNotificationCampaign.updateMany({
      where: {
        id,
        status: NotificationCampaignStatus.SCHEDULED,
        scheduledAt: { lte: now },
      },
      data: {
        status: NotificationCampaignStatus.SENDING,
        startedAt: now,
        lastAttemptAt: now,
        dispatchAttempts: { increment: 1 },
        failureMessage: null,
      },
    });
    if (claimed.count === 0) {
      claimed = await this.prisma.systemNotificationCampaign.updateMany({
        where: {
          id,
          status: NotificationCampaignStatus.SENDING,
          OR: [
            { lastAttemptAt: null },
            { lastAttemptAt: { lte: new Date(now.getTime() - DISPATCH_LEASE_MS) } },
          ],
          dispatchAttempts: { lt: MAX_DISPATCH_ATTEMPTS },
        },
        data: {
          lastAttemptAt: now,
          dispatchAttempts: { increment: 1 },
          failureMessage: null,
        },
      });
    }
    if (claimed.count !== 1) return;
    const campaign = await this.prisma.systemNotificationCampaign.findUniqueOrThrow({
      where: { id },
    });
    const audience = (campaign.audience ?? {}) as NotificationAudienceDto;
    let cursor = campaign.dispatchCursor ?? undefined;
    while (true) {
      const users = await this.prisma.user.findMany({
        where: this.audienceWhere(audience),
        select: { id: true },
        orderBy: { id: 'asc' },
        take: DISPATCH_BATCH_SIZE,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
      });
      if (users.length === 0) break;
      await this.notifications.notify(
        'system',
        users.map(({ id: userId }) => userId),
        campaign.content,
        {
          threadId:
            campaign.destinationType === 'THREAD'
              ? (campaign.destinationId ?? undefined)
              : undefined,
          payload: { title: campaign.title, campaignId: campaign.id },
          eventKey: `campaign:${campaign.id}`,
          campaignId: campaign.id,
        },
      );
      cursor = users.at(-1)!.id;
      await this.prisma.systemNotificationCampaign.updateMany({
        where: { id, status: NotificationCampaignStatus.SENDING },
        data: {
          dispatchCursor: cursor,
          recipientCount: { increment: users.length },
          lastAttemptAt: new Date(),
          failureMessage: null,
        },
      });
      if (users.length < DISPATCH_BATCH_SIZE) break;
    }
    await this.prisma.systemNotificationCampaign.update({
      where: { id },
      data: {
        status: NotificationCampaignStatus.SENT,
        sentAt: new Date(),
        failureMessage: null,
      },
    });
  }

  private audienceWhere(audience: NotificationAudienceDto): Prisma.UserWhereInput {
    return {
      deletedAt: null,
      ...(audience.roles?.length ? { role: { in: audience.roles as UserRole[] } } : {}),
    };
  }
}
