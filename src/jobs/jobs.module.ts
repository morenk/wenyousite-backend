import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationProducer } from './notification.producer';
import { NotificationProcessor } from './notification.processor';
import { PostEventsListener } from './post-events.listener';
import { CleanupTask } from './cleanup.task';
import { MentionsModule } from '../mentions/mentions.module';

/** 任务队列模块：BullMQ + 事件监听 + 定时任务 */
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
    MentionsModule,
  ],
  providers: [NotificationProducer, NotificationProcessor, PostEventsListener, CleanupTask],
  exports: [NotificationProducer],
})
export class JobsModule {}
