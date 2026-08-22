import { AuditAction, UserRole } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from '../moderation/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SiteOperationalSettingsService } from './site-operational-settings.service';

describe('SiteOperationalSettingsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    siteOperationalSettings: { upsert: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const actor = { id: 'admin-1', username: 'admin', role: UserRole.SUPER_ADMIN };
  const context = { requestId: 'request-1', ip: '127.0.0.1' };
  let service: SiteOperationalSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    audit.record.mockResolvedValue(undefined);
    prisma.siteOperationalSettings.upsert.mockResolvedValue({
      id: 'default',
      registrationPausedUntil: null,
      contentWritesPausedUntil: null,
    });
    service = new SiteOperationalSettingsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('读取时幂等创建默认设置', async () => {
    await service.get();
    expect(prisma.siteOperationalSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s 请求不读取暂停状态', async (method) => {
    await expect(service.assertRequestAllowed('/api/v1/threads', method)).resolves.toBeUndefined();
    expect(prisma.siteOperationalSettings.upsert).not.toHaveBeenCalled();
  });

  it('注册暂停时仅阻止注册写请求', async () => {
    const pausedUntil = new Date(Date.now() + 60_000);
    prisma.siteOperationalSettings.upsert.mockResolvedValue({
      registrationPausedUntil: pausedUntil,
      contentWritesPausedUntil: null,
    });

    await expect(
      service.assertRequestAllowed('/api/v1/auth/register/request-code', 'POST'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.REGISTRATION_PAUSED, status: 503 });
    await expect(
      service.assertRequestAllowed('/api/v1/auth/login', 'POST'),
    ).resolves.toBeUndefined();
  });

  it.each([
    '/api/v1/threads',
    '/api/v1/subthreads/one/posts',
    '/api/v1/posts/one',
    '/api/v1/drafts',
    '/api/v1/moments',
    '/api/v1/direct-messages',
    '/api/v1/media/upload',
    '/api/v1/stickers',
    '/api/v1/tags',
  ])('内容暂停时阻止 %s 写入', async (path) => {
    prisma.siteOperationalSettings.upsert.mockResolvedValue({
      registrationPausedUntil: null,
      contentWritesPausedUntil: new Date(Date.now() + 60_000),
    });

    await expect(service.assertRequestAllowed(path, 'PATCH')).rejects.toMatchObject({
      errorCode: ErrorCode.CONTENT_WRITES_PAUSED,
      status: 503,
    });
  });

  it('过期暂停窗口不阻止请求且五秒内复用缓存', async () => {
    prisma.siteOperationalSettings.upsert.mockResolvedValue({
      registrationPausedUntil: new Date(Date.now() - 1),
      contentWritesPausedUntil: new Date(Date.now() - 1),
    });

    await service.assertRequestAllowed('/api/v1/auth/register/request-code', 'POST');
    await service.assertRequestAllowed('/api/v1/threads', 'POST');

    expect(prisma.siteOperationalSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it('原子更新所有可选字段、裁剪文本并写审计', async () => {
    const registration = '2026-08-23T01:00:00.000Z';
    const content = '2026-08-23T02:00:00.000Z';
    const start = '2026-08-23T03:00:00.000Z';
    const end = '2026-08-23T04:00:00.000Z';
    prisma.siteOperationalSettings.upsert.mockResolvedValue({ id: 'default' });

    await service.update(
      actor,
      {
        registrationPausedUntil: registration,
        contentWritesPausedUntil: content,
        maintenanceTitle: '  维护标题  ',
        maintenanceContent: '  维护正文  ',
        maintenanceStartsAt: start,
        maintenanceEndsAt: end,
      },
      context,
    );

    expect(prisma.siteOperationalSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: {
        id: 'default',
        registrationPausedUntil: new Date(registration),
        contentWritesPausedUntil: new Date(content),
        maintenanceTitle: '维护标题',
        maintenanceContent: '维护正文',
        maintenanceStartsAt: new Date(start),
        maintenanceEndsAt: new Date(end),
      },
      update: {
        registrationPausedUntil: new Date(registration),
        contentWritesPausedUntil: new Date(content),
        maintenanceTitle: '维护标题',
        maintenanceContent: '维护正文',
        maintenanceStartsAt: new Date(start),
        maintenanceEndsAt: new Date(end),
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SITE_SETTINGS_UPDATED,
        metadata: expect.objectContaining({
          changedFields: expect.arrayContaining([
            'registrationPausedUntil',
            'contentWritesPausedUntil',
            'maintenanceTitle',
          ]),
        }),
      }),
      prisma,
    );
  });

  it('空字符串显式清空设置，更新后失效暂停缓存', async () => {
    prisma.siteOperationalSettings.upsert
      .mockResolvedValueOnce({
        registrationPausedUntil: new Date(Date.now() - 1),
        contentWritesPausedUntil: null,
      })
      .mockResolvedValueOnce({ id: 'default' })
      .mockResolvedValueOnce({ registrationPausedUntil: null, contentWritesPausedUntil: null });
    await service.assertRequestAllowed('/api/v1/auth/register/request-code', 'POST');

    await service.update(
      actor,
      {
        registrationPausedUntil: '',
        contentWritesPausedUntil: '',
        maintenanceTitle: ' ',
        maintenanceContent: '',
        maintenanceStartsAt: '',
        maintenanceEndsAt: '',
      },
      context,
    );
    await service.assertRequestAllowed('/api/v1/auth/register/request-code', 'POST');

    expect(prisma.siteOperationalSettings.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.siteOperationalSettings.upsert.mock.calls[1][0].update).toEqual({
      registrationPausedUntil: null,
      contentWritesPausedUntil: null,
      maintenanceTitle: null,
      maintenanceContent: null,
      maintenanceStartsAt: null,
      maintenanceEndsAt: null,
    });
  });

  it('拒绝结束时间不晚于开始时间的维护窗口', async () => {
    await expect(
      service.update(
        actor,
        {
          maintenanceStartsAt: '2026-08-23T04:00:00.000Z',
          maintenanceEndsAt: '2026-08-23T04:00:00.000Z',
        },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
