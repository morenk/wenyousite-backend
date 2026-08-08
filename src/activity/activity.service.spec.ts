import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ActivityService } from './activity.service';

describe('ActivityService', () => {
  const prisma = { userDailyActivity: { createMany: jest.fn() } };
  const redis = { setIfAbsent: jest.fn(), del: jest.fn() };
  let service: ActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ActivityService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  it('persists a user once when the daily reservation succeeds', async () => {
    redis.setIfAbsent.mockResolvedValue(true);
    prisma.userDailyActivity.createMany.mockResolvedValue({ count: 1 });

    await service.record('user-1', new Date('2026-08-07T16:30:00.000Z'));

    expect(prisma.userDailyActivity.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          dateKey: '2026-08-08',
          firstSeenAt: new Date('2026-08-07T16:30:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('skips the database when another instance already recorded the day', async () => {
    redis.setIfAbsent.mockResolvedValue(false);
    await service.record('user-1');
    expect(prisma.userDailyActivity.createMany).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis is unavailable', async () => {
    redis.setIfAbsent.mockRejectedValue(new Error('redis down'));
    prisma.userDailyActivity.createMany.mockResolvedValue({ count: 0 });
    await service.record('user-1');
    expect(prisma.userDailyActivity.createMany).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when persistence fails', async () => {
    redis.setIfAbsent.mockResolvedValue(true);
    prisma.userDailyActivity.createMany.mockRejectedValue(new Error('db down'));
    redis.del.mockResolvedValue(1);

    await expect(service.record('user-1')).rejects.toThrow('db down');
    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});
