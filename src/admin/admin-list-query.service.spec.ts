import {
  ModerationAppealStatus,
  ModerationDecisionAction,
  NotificationCampaignStatus,
  ReportTargetType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { AuditService } from './audit.service';
import { ModerationService } from './moderation.service';
import { ModerationCasesService } from './moderation-cases.service';
import { NotificationCampaignService } from './notification-campaign.service';

describe('管理员列表组合筛选', () => {
  it('申诉按状态、目标类型和处置动作组合筛选并分页', async () => {
    const prisma = {
      moderationAppeal: {
        findMany: jest.fn().mockResolvedValue([{ id: 'appeal-2' }, { id: 'appeal-1' }]),
      },
    };
    const service = new ModerationCasesService(
      prisma as unknown as PrismaService,
      {} as ModerationService,
      {} as AuditService,
    );

    const result = await service.listAppeals({
      status: ModerationAppealStatus.PENDING,
      targetType: ReportTargetType.POST,
      action: ModerationDecisionAction.HIDE_CONTENT,
      limit: 1,
    });

    expect(result.pagination).toEqual({ cursor: 'appeal-2', hasMore: true });
    expect(prisma.moderationAppeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ModerationAppealStatus.PENDING,
          decision: {
            targetType: ReportTargetType.POST,
            action: ModerationDecisionAction.HIDE_CONTENT,
          },
        },
        take: 2,
      }),
    );
  });

  it('通知活动按关键词、状态和跳转目标组合筛选并分页', async () => {
    const prisma = {
      systemNotificationCampaign: {
        findMany: jest.fn().mockResolvedValue([{ id: 'campaign-2' }, { id: 'campaign-1' }]),
      },
    };
    const service = new NotificationCampaignService(
      prisma as unknown as PrismaService,
      {} as NotificationProducer,
      {} as AuditService,
    );

    const result = await service.list({
      q: ' 维护 ',
      status: NotificationCampaignStatus.SCHEDULED,
      destination: 'THREAD',
      limit: 1,
    });

    expect(result.pagination).toEqual({ cursor: 'campaign-2', hasMore: true });
    expect(prisma.systemNotificationCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: NotificationCampaignStatus.SCHEDULED,
          OR: [
            { title: { contains: '维护', mode: 'insensitive' } },
            { content: { contains: '维护', mode: 'insensitive' } },
          ],
          destinationType: 'THREAD',
        },
        take: 2,
      }),
    );
  });
});
