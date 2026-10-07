import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { ThrottlerRedisStorage } from './throttler-redis.storage';
import { CacheInvalidationListener } from './cache-invalidation.listener';
import { redisConnectionOptions } from './redis-connection';
import { createRequestRedis } from './redis-client-policy';
import { createCacheStore } from './redis-cache';

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
          stores: [createCacheStore(connection)],
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
        return createRequestRedis(redisConnectionOptions(config));
      },
    },
    RedisService,
    CacheService,
    ThrottlerRedisStorage,
    CacheInvalidationListener,
  ],
  exports: [CacheModule, 'REDIS_CLIENT', RedisService, CacheService, ThrottlerRedisStorage],
})
export class RedisModule {}
