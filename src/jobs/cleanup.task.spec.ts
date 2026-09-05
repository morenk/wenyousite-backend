/** 定时清理任务测试：孤儿图片清理接入 + 失败不影响其他清理 */
import { Test, TestingModule } from '@nestjs/testing';
import { CleanupTask } from './cleanup.task';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadRankingService } from '../threads/thread-ranking.service';
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

const mockRanking = { rebuild: jest.fn().mockResolvedValue(undefined) };

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
        { provide: ThreadRankingService, useValue: mockRanking },
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

  it('未发布主题按创建超过七天清理，编辑时间不延长且不清理独立云草稿', async () => {
    const now = new Date('2026-09-05T04:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    await task.cleanup();
    expect(mockPrisma.thread.deleteMany).toHaveBeenCalledWith({
      where: { published: false, createdAt: { lt: new Date('2026-08-29T04:00:00.000Z') } },
    });
  });

  it('孤儿图片清理抛错不应影响其他清理任务', async () => {
    mockMediaService.cleanupOrphanMedia.mockRejectedValueOnce(new Error('cos down'));
    await expect(task.cleanup()).resolves.toBeUndefined();
    expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalled();
  });

  it('定时维护调用数据库权威重建', async () => {
    await task.recalcSmartScores();
    expect(mockRanking.rebuild).toHaveBeenCalledTimes(1);
  });
});
