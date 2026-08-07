import Redis from 'ioredis';
import { ThrottlerRedisStorage } from './throttler-redis.storage';

describe('ThrottlerRedisStorage', () => {
  const redis = { eval: jest.fn() };
  let storage: ThrottlerRedisStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new ThrottlerRedisStorage(redis as unknown as Redis);
  });

  it('使用带命名空间的 Redis Lua 原子累加并返回剩余窗口', async () => {
    redis.eval.mockResolvedValue([1, 9_500]);

    await expect(storage.increment('client-1', 10_000, 3, 0, 'default')).resolves.toEqual({
      totalHits: 1,
      timeToExpire: 9_500,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'throttle:default:client-1',
      10_000,
    );
  });

  it('超过限制时沿用当前窗口作为阻止剩余时间', async () => {
    redis.eval.mockResolvedValue([4, 8_000]);

    await expect(storage.increment('client-1', 10_000, 3, 60, 'auth')).resolves.toEqual({
      totalHits: 4,
      timeToExpire: 8_000,
      isBlocked: true,
      timeToBlockExpire: 8_000,
    });
  });

  it('Redis 返回已过期 TTL 时钳制为零且 limit=0 永不阻止', async () => {
    redis.eval.mockResolvedValue([100, -1]);

    await expect(storage.increment('client-1', 10_000, 0, 60, 'disabled')).resolves.toEqual({
      totalHits: 100,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});
