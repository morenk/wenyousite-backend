import { NotificationProducer } from '../notifications/notification.producer';
import { PrismaService } from '../prisma/prisma.service';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';

describe('AdminService', () => {
  const prisma = {
    user: { count: jest.fn(), findMany: jest.fn() },
    notification: { findMany: jest.fn() },
  };
  const producer = { notify: jest.fn() };
  const audit = { record: jest.fn() };
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    producer.notify.mockResolvedValue(undefined);
    audit.record.mockResolvedValue({});
    service = new AdminService(
      prisma as unknown as PrismaService,
      producer as unknown as NotificationProducer,
      audit as unknown as AuditService,
    );
    jest
      .spyOn(
        (service as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('显式接收者优先于条件且始终排除注销用户', () => {
    expect(
      service.buildRecipientWhere({
        recipientIds: ['user-1'],
        conditions: { emailVerified: true },
      } as SendSystemNotificationDto),
    ).toEqual({
      id: { in: ['user-1'] },
      deletedAt: null,
    });
  });

  it('组合角色、验证状态和注册时间条件', () => {
    expect(
      service.buildRecipientWhere({
        conditions: {
          role: ['USER'],
          emailVerified: false,
          createdAfter: '2026-01-01T00:00:00.000Z',
          createdBefore: '2026-06-01T00:00:00.000Z',
        },
      } as SendSystemNotificationDto),
    ).toEqual({
      deletedAt: null,
      role: { in: ['USER'] },
      emailVerified: false,
      createdAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-06-01T00:00:00.000Z'),
      },
    });
  });

  it('预览仅统计接收者而不发送', async () => {
    prisma.user.count.mockResolvedValue(12);
    const dto = { conditions: { emailVerified: true } } as SendSystemNotificationDto;

    await expect(service.previewRecipients(dto)).resolves.toEqual({ recipientCount: 12 });
    expect(producer.notify).not.toHaveBeenCalled();
  });

  it('没有接收者时不入队也不写审计日志', async () => {
    prisma.user.count.mockResolvedValue(0);

    await expect(
      service.sendSystemNotification(
        { content: '维护通知' } as SendSystemNotificationDto,
        'admin-1',
      ),
    ).resolves.toEqual({ recipientCount: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(producer.notify).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('按稳定游标分批发送并用同一事件键写审计日志', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({ id: `user-${index}` }));
    prisma.user.count.mockResolvedValue(502);
    prisma.user.findMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 'user-500' }, { id: 'user-501' }]);
    const content = '系'.repeat(250);

    await expect(
      service.sendSystemNotification(
        {
          content,
          payload: { kind: 'maintenance' },
          threadId: 'thread-1',
        } as SendSystemNotificationDto,
        'admin-1',
        '127.0.0.1',
      ),
    ).resolves.toEqual({ recipientCount: 502, estimatedCount: 502 });

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'user-499' },
        skip: 1,
      }),
    );
    expect(producer.notify).toHaveBeenCalledTimes(2);
    const firstOptions = producer.notify.mock.calls[0][3];
    const secondOptions = producer.notify.mock.calls[1][3];
    expect(firstOptions.eventKey).toMatch(/^system:admin-1:/);
    expect(secondOptions.eventKey).toBe(firstOptions.eventKey);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'SYSTEM_NOTIFICATION_SENT',
        ip: '127.0.0.1',
        metadata: expect.objectContaining({ content: '系'.repeat(200) }),
      }),
    );
  });

  it('历史查询限制最大页长并正确生成下一页游标', async () => {
    const notifications = Array.from({ length: 51 }, (_, index) => ({ id: `n-${index}` }));
    prisma.notification.findMany.mockResolvedValue(notifications);

    await expect(service.getSystemNotificationHistory('n-before', 100)).resolves.toEqual({
      data: notifications.slice(0, 50),
      cursor: 'n-49',
      hasMore: true,
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'system' },
        take: 51,
        cursor: { id: 'n-before' },
        skip: 1,
      }),
    );
  });

  it('空历史返回空游标', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await expect(service.getSystemNotificationHistory()).resolves.toEqual({
      data: [],
      cursor: null,
      hasMore: false,
    });
  });

  it('用户搜索排除注销用户并限制最大条数', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

    await expect(service.searchUsers('alice', 100)).resolves.toEqual({ data: [{ id: 'user-1' }] });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: 'alice', mode: 'insensitive' } },
          { email: { contains: 'alice', mode: 'insensitive' } },
        ],
      },
      select: expect.any(Object),
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  });
});
