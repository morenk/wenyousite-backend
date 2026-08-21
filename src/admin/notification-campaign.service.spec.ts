import { NotificationCampaignStatus } from '@prisma/client';
import { NotificationProducer } from '../notifications/notification.producer';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { NotificationCampaignService } from './notification-campaign.service';

describe('NotificationCampaignService dispatch', () => {
  const prisma = {
    systemNotificationCampaign: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  let service: NotificationCampaignService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationCampaignService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationProducer,
      {} as AuditService,
    );
    jest
      .spyOn(
        (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('租约过期的发送中活动从持久游标续传并逐批保存进度', async () => {
    prisma.systemNotificationCampaign.findMany.mockResolvedValue([{ id: 'campaign-1' }]);
    prisma.systemNotificationCampaign.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.systemNotificationCampaign.findUniqueOrThrow.mockResolvedValue({
      id: 'campaign-1',
      audience: {},
      dispatchCursor: 'user-500',
      title: '维护通知',
      content: '系统将进行维护',
      destinationType: null,
      destinationId: null,
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-501' }, { id: 'user-502' }]);
    notifications.notify.mockResolvedValue(undefined);
    prisma.systemNotificationCampaign.update.mockResolvedValue({});

    await service.dispatchDueCampaigns();

    expect(prisma.systemNotificationCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            expect.objectContaining({ status: NotificationCampaignStatus.SCHEDULED }),
            expect.objectContaining({
              status: NotificationCampaignStatus.SENDING,
              OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: expect.any(Date) } }],
              dispatchAttempts: { lt: 10 },
            }),
          ],
        },
      }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'user-500' }, skip: 1 }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      'system',
      ['user-501', 'user-502'],
      '系统将进行维护',
      expect.objectContaining({ eventKey: 'campaign:campaign-1' }),
    );
    expect(prisma.systemNotificationCampaign.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          dispatchCursor: 'user-502',
          recipientCount: { increment: 2 },
        }),
      }),
    );
    expect(prisma.systemNotificationCampaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: {
        status: NotificationCampaignStatus.SENT,
        sentAt: expect.any(Date),
        failureMessage: null,
      },
    });
  });

  it('临时投递失败保留 SENDING 和游标，等待租约过期后重试', async () => {
    prisma.systemNotificationCampaign.findMany.mockResolvedValue([{ id: 'campaign-1' }]);
    prisma.systemNotificationCampaign.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.systemNotificationCampaign.findUniqueOrThrow.mockResolvedValue({
      id: 'campaign-1',
      audience: {},
      dispatchCursor: null,
      title: '通知',
      content: '正文',
      destinationType: null,
      destinationId: null,
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
    notifications.notify.mockRejectedValue(new Error('queue unavailable'));

    await service.dispatchDueCampaigns();

    expect(prisma.systemNotificationCampaign.update).not.toHaveBeenCalled();
    expect(prisma.systemNotificationCampaign.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'campaign-1', status: NotificationCampaignStatus.SENDING },
      data: { failureMessage: 'queue unavailable' },
    });
  });

  it('达到最大领取次数后才进入 FAILED 终态', async () => {
    prisma.systemNotificationCampaign.findMany.mockResolvedValue([{ id: 'campaign-1' }]);
    prisma.systemNotificationCampaign.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.systemNotificationCampaign.findUniqueOrThrow.mockRejectedValue(
      new Error('database unavailable'),
    );

    await service.dispatchDueCampaigns();

    expect(prisma.systemNotificationCampaign.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'campaign-1',
        status: NotificationCampaignStatus.SENDING,
        dispatchAttempts: { gte: 10 },
      },
      data: {
        status: NotificationCampaignStatus.FAILED,
        failureMessage: 'database unavailable',
      },
    });
  });
});
