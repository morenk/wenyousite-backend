import { Injectable, Inject } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

/** 限流存储记录 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/** Redis 限流存储：替换默认内存存储，支持多实例部署 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,           // 窗口大小，毫秒
    limit: number,         // 不限流时用作累加上限
    blockDuration: number, // 锁定时间，秒
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;

    // Lua 脚本保证原子性：先 INCR，若首次则设置 TTL
    const script = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('PTTL', KEYS[1])
      return { current, ttl }
    `;

    const result = await this.redis.eval(script, 1, redisKey, ttl) as [number, number];
    const totalHits = result[0];
    const timeToExpire = Math.max(result[1], 0);

    const isBlocked = limit > 0 && totalHits > limit;
    const timeToBlockExpire = isBlocked ? timeToExpire : 0;

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }
}
