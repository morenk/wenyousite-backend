import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationProducer } from './notification.producer';
import { NotificationProcessor } from './notification.processor';
import { PrismaModule } from '../prisma/prisma.module';

/** 任务队列模块：注册 BullMQ queue 与 processor */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notification',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
      },
    }),
  ],
  providers: [NotificationProducer, NotificationProcessor],
  exports: [NotificationProducer],
})
export class JobsModule {}
