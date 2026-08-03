/** 定时清理任务测试：孤儿图片清理接入 + 失败不影响其他清理 */
import { Test, TestingModule } from '@nestjs/testing';
import { CleanupTask } from './cleanup.task';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';

const mockPrisma = {
  emailVerification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  thread: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
};

const mockMediaService = {
  cleanupOrphanMedia: jest.fn().mockResolvedValue(undefined),
};

describe('CleanupTask', () => {
  let task: CleanupTask;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupTask,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: {} },
        { provide: MediaService, useValue: mockMediaService },
      ],
    }).compile();
    task = module.get<CleanupTask>(CleanupTask);
    jest.clearAllMocks();
  });

  it('cleanup 应调用孤儿图片清理', async () => {
    await task.cleanup();
    expect(mockMediaService.cleanupOrphanMedia).toHaveBeenCalledTimes(1);
  });

  it('孤儿图片清理抛错不应影响其他清理任务', async () => {
    mockMediaService.cleanupOrphanMedia.mockRejectedValueOnce(new Error('cos down'));
    await expect(task.cleanup()).resolves.toBeUndefined();
    expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalled();
  });
});
