import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
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
import { JobsModule } from './jobs/jobs.module';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { validate } from './config/env.validation';

/** 根模块：注册所有特性模块和全局功能 */
@Module({
  imports: [
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
    JobsModule,
  ],
})
export class AppModule {}
