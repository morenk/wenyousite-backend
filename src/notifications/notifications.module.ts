import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { BullModule } from '@nestjs/bullmq';
import { NotificationProducer } from './notification.producer';
import { NotificationProcessor } from './notification.processor';
import { MobilePushModule } from '../mobile-push/mobile-push.module';

/** 站内通知模块：CRUD、未读数、处理器 */
@Module({
  imports: [
    MobilePushModule,
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
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationProducer, NotificationProcessor],
  exports: [NotificationsService, NotificationProducer],
})
export class NotificationsModule {}
