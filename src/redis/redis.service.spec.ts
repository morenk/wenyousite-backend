import { RedisService } from './redis.service';
import type Redis from 'ioredis';

describe('RedisService', () => {
  it('hincrbyAtLeast 通过 Lua 原子提升下限并自增', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue(42),
      quit: jest.fn(),
    };
    const service = new RedisService(redis as unknown as Redis);

    await expect(
      service.hincrbyAtLeast('thread:t1:stats', 'views', 40, 1),
    ).resolves.toBe(42);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('HINCRBY'"),
      1,
      'thread:t1:stats',
      'views',
      '40',
      '1',
    );
  });
});
