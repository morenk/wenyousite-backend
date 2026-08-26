import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import Redis from 'ioredis';
import { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { ThrottlerRedisStorage } from './throttler-redis.storage';
import { CacheInvalidationListener } from './cache-invalidation.listener';
import { redisConnectionOptions, redisConnectionUrl } from './redis-connection';

/** Redis 全局模块：提供缓存(CacheManager)、计数器(RedisService)、限流存储(ThrottlerRedisStorage) */
@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connection = redisConnectionOptions(config);
        return {
          stores: [createKeyv(redisConnectionUrl(connection))],
          ttl: 60000, // 默认 60 秒
        };
      },
    }),
  ],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis({
          ...redisConnectionOptions(config),
          lazyConnect: true,
          maxRetriesPerRequest: null, // BullMQ 兼容
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
      },
    },
    RedisService,
    CacheService,
    ThrottlerRedisStorage,
    CacheInvalidationListener,
  ],
  exports: [
    CacheModule,
    'REDIS_CLIENT',
    RedisService,
    CacheService,
    ThrottlerRedisStorage,
  ],
})
export class RedisModule {}
