import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis-health.indicator';
import { RedisService } from '../redis/redis.service';

describe('RedisHealthIndicator', () => {
  const indicator = new HealthIndicatorService();

  it('Redis PING 成功时返回 up', async () => {
    const redis = { ping: jest.fn().mockResolvedValue('PONG') } as unknown as RedisService;
    const health = new RedisHealthIndicator(indicator, redis);

    await expect(health.check()).resolves.toEqual({ redis: { status: 'up' } });
  });

  it('Redis PING 失败时返回 down 和错误信息', async () => {
    const redis = { ping: jest.fn().mockRejectedValue(new Error('connection refused')) } as unknown as RedisService;
    const health = new RedisHealthIndicator(indicator, redis);

    await expect(health.check()).resolves.toEqual({
      redis: { status: 'down', message: 'connection refused' },
    });
  });
});
