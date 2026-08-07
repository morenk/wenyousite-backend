import { MobilePlatform } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { MobileDeviceService } from './mobile-device.service';

describe('MobileDeviceService', () => {
  const tx = {
    mobileDevice: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    refreshToken: { findFirst: jest.fn(), findMany: jest.fn() },
    mobileDevice: { updateMany: jest.fn(), findMany: jest.fn() },
  };
  const service = new MobileDeviceService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'refresh1' });
    tx.mobileDevice.upsert.mockResolvedValue({
      id: 'device1',
      platform: MobilePlatform.ANDROID,
      appVersion: '1.0.0',
      locale: 'zh-CN',
      enabled: true,
      lastSeenAt: new Date('2026-08-07T00:00:00.000Z'),
    });
  });

  it('拒绝未绑定登录终端的 access token', async () => {
    await expect(service.register('u1', undefined, {
      pushToken: 'a'.repeat(32),
      platform: 'android',
    })).rejects.toMatchObject({ errorCode: ErrorCode.SESSION_NOT_FOUND, status: 401 });
  });

  it('只允许活跃 mobile family 注册，并且不回传 push token', async () => {
    const result = await service.register('u1', 'family1', {
      pushToken: 'a'.repeat(32),
      platform: 'android',
      appVersion: '1.0.0',
      locale: 'zh-CN',
    });

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        family: 'family1',
        platform: 'mobile',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(tx.mobileDevice.deleteMany).toHaveBeenCalledWith({
      where: { pushToken: 'a'.repeat(32), NOT: { userId: 'u1', sessionId: 'family1' } },
    });
    expect(tx.mobileDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_sessionId: { userId: 'u1', sessionId: 'family1' } },
        create: expect.objectContaining({ platform: MobilePlatform.ANDROID }),
      }),
    );
    expect(result).toEqual({
      id: 'device1',
      platform: 'android',
      appVersion: '1.0.0',
      locale: 'zh-CN',
      enabled: true,
      lastSeenAt: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(result).not.toHaveProperty('pushToken');
  });

  it('批量停用没有活跃 refresh family 的设备', async () => {
    prisma.mobileDevice.findMany.mockResolvedValue([
      { id: 'd1', userId: 'u1', sessionId: 'f1' },
      { id: 'd2', userId: 'u2', sessionId: 'f2' },
    ]);
    prisma.refreshToken.findMany.mockResolvedValue([{ userId: 'u1', family: 'f1' }]);
    prisma.mobileDevice.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cleanupInactiveSessions()).resolves.toBe(1);
    expect(prisma.mobileDevice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d2'] } },
      data: { enabled: false },
    });
  });
});
