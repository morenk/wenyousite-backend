import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from '../config/configuration';
import { validate } from '../config/env.validation';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { MediaModule } from './media.module';
import { ImageProcessor } from './image.processor';
import { redisConnectionOptions } from '../redis/redis-connection';

/** 独立图片 Worker：只消费 image 队列，不启动 HTTP 服务器或其他业务消费者。 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionOptions(config),
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MediaModule,
  ],
  providers: [ImageProcessor],
})
export class ImageWorkerModule {}
