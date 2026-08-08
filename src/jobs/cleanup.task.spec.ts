/** 定时清理任务测试：孤儿图片清理接入 + 失败不影响其他清理 */
import { Test, TestingModule } from '@nestjs/testing';
import { CleanupTask } from './cleanup.task';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';
import { StickersService } from '../stickers/stickers.service';
import { MobileDeviceService } from '../mobile-push/mobile-device.service';

const mockPrisma = {
  emailVerification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  thread: {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  domainOutbox: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  $executeRaw: jest.fn().mockResolvedValue(1),
};

const mockRedis = {
  hgetall: jest.fn().mockResolvedValue({}),
  hset: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
};

const mockMediaService = {
  cleanupOrphanMedia: jest.fn().mockResolvedValue(undefined),
};
const mockStickersService = { cleanupOrphanAssets: jest.fn().mockResolvedValue(undefined) };
const mockMobileDevices = { cleanupInactiveSessions: jest.fn().mockResolvedValue(0) };

describe('CleanupTask', () => {
  let task: CleanupTask;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupTask,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: MediaService, useValue: mockMediaService },
        { provide: StickersService, useValue: mockStickersService },
        { provide: MobileDeviceService, useValue: mockMobileDevices },
      ],
    }).compile();
    task = module.get<CleanupTask>(CleanupTask);
    jest.clearAllMocks();
    jest.spyOn(
      (task as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('cleanup 应调用孤儿图片清理', async () => {
    await task.cleanup();
    expect(mockMediaService.cleanupOrphanMedia).toHaveBeenCalledTimes(1);
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    expect(mockPrisma.domainOutbox.deleteMany).toHaveBeenCalledWith({
      where: { processedAt: { not: null, lt: expect.any(Date) } },
    });
    expect(mockMobileDevices.cleanupInactiveSessions).toHaveBeenCalledTimes(1);
  });

  it('孤儿图片清理抛错不应影响其他清理任务', async () => {
    mockMediaService.cleanupOrphanMedia.mockRejectedValueOnce(new Error('cos down'));
    await expect(task.cleanup()).resolves.toBeUndefined();
    expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalled();
  });

  it('recalcSmartScores 应将 Redis 浏览量批量落盘', async () => {
    mockPrisma.thread.findMany.mockResolvedValueOnce([
      { id: 't1', createdAt: new Date(Date.now() - 3600000), viewCount: 5 },
      { id: 't2', createdAt: new Date(Date.now() - 7200000), viewCount: 7 },
    ]);
    mockRedis.hgetall
      .mockResolvedValueOnce({ views: '9', replies: '2', likes: '1' })
      .mockResolvedValueOnce({ views: '7', replies: '0', likes: '0' });

    await task.recalcSmartScores();

    expect(mockRedis.zadd).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
