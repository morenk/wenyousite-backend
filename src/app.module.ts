import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TagsModule } from './tags/tags.module';
import { ThreadsModule } from './threads/threads.module';
import { SubthreadsModule } from './subthreads/subthreads.module';
import { PostsModule } from './posts/posts.module';
import { DraftsModule } from './drafts/drafts.module';
import { MentionsModule } from './mentions/mentions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { EmailModule } from './email/email.module';
import { MediaModule } from './media/media.module';
import { JobsModule } from './jobs/jobs.module';
import { PostActivityModule } from './post-activity/post-activity.module';
import { OutboxModule } from './outbox/outbox.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CommonModule } from './common/common.module';
import { RedisModule } from './redis/redis.module';
import { DiceModule } from './dice/dice.module';
import { DirectMessagesModule } from './direct-messages/direct-messages.module';
import { StickersModule } from './stickers/stickers.module';
import { MetaModule } from './meta/meta.module';
import { MobilePushModule } from './mobile-push/mobile-push.module';
import { ThrottlerRedisStorage } from './redis/throttler-redis.storage';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { requestIdFromHeader } from './common/http/request-id';
import { ProgressionModule } from './progression/progression.module';
import { EconomyModule } from './economy/economy.module';
import { ActivityModule } from './activity/activity.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';

/** 构建 Pino 传输配置：开发环境 colorized 控制台，生产环境支持可选文件日志 */
function buildPinoTransport(logLevel: string, nodeEnv: string, logFileDir?: string) {
  const isProd = nodeEnv === 'production';

  if (!isProd) {
    return { target: 'pino-pretty', options: { colorize: true, singleLine: true } };
  }

  const targets: any[] = [
    {
      target: 'pino-pretty',
      options: { colorize: false, destination: 1, singleLine: true },
      level: logLevel,
    },
  ];
  if (logFileDir) {
    targets.push({
      target: 'pino-roll',
      options: { file: logFileDir, frequency: 'daily', mkdir: true, size: '10m' },
      level: logLevel,
    });
  }
  return { targets };
}

/** 根模块：注册所有特性模块和全局功能 */
@Module({
  imports: [
    // 环境变量配置
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env.local', '.env'],
    }),
    // 全局日志：Pino 结构化日志 + HTTP 请求自动记录
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logLevel = config.get<string>('log.level') ?? 'info';
        const logFileDir = config.get<string>('log.fileDir');
        const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
        return {
          pinoHttp: {
            level: logLevel,
            genReqId: (req: any) => requestIdFromHeader(req.headers['x-request-id']),
            transport: buildPinoTransport(logLevel, nodeEnv, logFileDir),
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              `req.headers['x-refresh-token']`,
            ],
            serializers: {
              req: (req: any) => ({ id: req.id, method: req.method, url: req.url }),
              res: (res: any) => ({ statusCode: res.statusCode }),
            },
          },
        };
      },
    }),
    // BullMQ 队列：全局 Redis 连接
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
        },
      }),
    }),
    // Redis 模块（缓存、计数器、限流存储）
    RedisModule,
    // 全局限流：每秒最多 10 个请求，使用 Redis 存储支持多实例
    ThrottlerModule.forRootAsync({
      inject: [ThrottlerRedisStorage],
      useFactory: (storage: ThrottlerStorage) => ({
        storage,
        throttlers: [{ ttl: 1000, limit: 10 }],
      }),
    }),
    // 事件发射器：模块间解耦（发帖 → 通知/提及/订阅等）
    EventEmitterModule.forRoot(),
    // 定时任务：清理过期数据
    ScheduleModule.forRoot(),
    // 基础设施模块
    PrismaModule,
    HealthModule,
    CommonModule,
    DiceModule,
    // 业务模块
    AuthModule,
    UsersModule,
    TagsModule,
    ThreadsModule,
    SubthreadsModule,
    PostsModule,
    DraftsModule,
    MentionsModule,
    NotificationsModule,
    SubscriptionsModule,
    ReportsModule,
    AdminModule,
    SearchModule,
    EmailModule,
    MediaModule,
    JobsModule,
    PostActivityModule,
    OutboxModule,
    BookmarksModule,
    DirectMessagesModule,
    StickersModule,
    MetaModule,
    MobilePushModule,
    ProgressionModule,
    EconomyModule,
    ActivityModule,
    TaxonomyModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
