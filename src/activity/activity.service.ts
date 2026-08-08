import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { analyticsDateKey } from './activity-date';

const ACTIVITY_DEDUP_TTL_SECONDS = 172_800;

/** 将普通用户的成功 API 使用压缩为每天一行活跃事实。 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async record(userId: string, occurredAt = new Date()): Promise<void> {
    const dateKey = analyticsDateKey(occurredAt);
    const cacheKey = `activity:daily:${dateKey}:${userId}`;
    let reserved = false;

    try {
      reserved = await this.redis.setIfAbsent(cacheKey, ACTIVITY_DEDUP_TTL_SECONDS, '1');
      if (!reserved) return;
    } catch {
      // Redis 只负责降写放大；不可用时仍由数据库唯一键保证正确性。
    }

    try {
      await this.prisma.userDailyActivity.createMany({
        data: [{ userId, dateKey, firstSeenAt: occurredAt }],
        skipDuplicates: true,
      });
    } catch (error) {
      if (reserved) await this.redis.del(cacheKey).catch(() => undefined);
      throw error;
    }
  }
}
