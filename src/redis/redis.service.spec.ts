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

  it('zaddMultiWithExpiry 在一个 Redis 事务内写入快照与 TTL', async () => {
    const chain = {
      zadd: jest.fn(),
      expire: jest.fn(),
      exec: jest.fn().mockResolvedValue([
        [null, 2],
        [null, 1],
      ]),
    };
    chain.zadd.mockReturnValue(chain);
    chain.expire.mockReturnValue(chain);
    const redis = {
      multi: jest.fn().mockReturnValue(chain),
      del: jest.fn(),
    };
    const service = new RedisService(redis as unknown as Redis);

    await expect(
      service.zaddMultiWithExpiry('moments:snapshot:1', 900, 0, 'moment-1', 1, 'moment-2'),
    ).resolves.toBe(2);
    expect(chain.zadd).toHaveBeenCalledWith(
      'moments:snapshot:1',
      0,
      'moment-1',
      1,
      'moment-2',
    );
    expect(chain.expire).toHaveBeenCalledWith('moments:snapshot:1', 900);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('zaddMultiWithExpiry 任一子命令失败时清理残留快照并上抛', async () => {
    const chain = {
      zadd: jest.fn(),
      expire: jest.fn(),
      exec: jest.fn().mockResolvedValue([
        [null, 2],
        [new Error('expire failed'), null],
      ]),
    };
    chain.zadd.mockReturnValue(chain);
    chain.expire.mockReturnValue(chain);
    const redis = {
      multi: jest.fn().mockReturnValue(chain),
      del: jest.fn().mockResolvedValue(1),
    };
    const service = new RedisService(redis as unknown as Redis);

    await expect(
      service.zaddMultiWithExpiry('moments:snapshot:broken', 900, 0, 'moment-1'),
    ).rejects.toThrow('Redis ZSET snapshot transaction failed');
    expect(redis.del).toHaveBeenCalledWith('moments:snapshot:broken');
  });
});
