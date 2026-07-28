import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BlockGuard } from './common/guards/block.guard';
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
import { ReadingProgressModule } from './reading-progress/reading-progress.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { EmailModule } from './email/email.module';
import { MediaModule } from './media/media.module';
import { JobsModule } from './jobs/jobs.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { validate } from './config/env.validation';

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
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
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
    // 全局限流：每秒最多 10 个请求
    ThrottlerModule.forRoot([{ ttl: 1000, limit: 10 }]),
    // 事件发射器：模块间解耦（发帖 → 通知/提及/订阅等）
    EventEmitterModule.forRoot(),
    // 定时任务：清理过期数据
    ScheduleModule.forRoot(),
    // 基础设施模块
    PrismaModule,
    HealthModule,
    CommonModule,
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
    ReadingProgressModule,
    ReportsModule,
    AdminModule,
    SearchModule,
    EmailModule,
    MediaModule,
    JobsModule,
    BookmarksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BlockGuard },
  ],
})
export class AppModule {}
