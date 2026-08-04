import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

/** Redis readiness 指标：确认缓存、限流和 BullMQ 共用连接可用 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  /** 执行 PING 并返回 Terminus 标准健康结果 */
  async check() {
    const status = this.indicator.check('redis');
    try {
      await this.redis.ping();
      return status.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redis unavailable';
      return status.down(message);
    }
  }
}
