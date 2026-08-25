import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationProducer } from './notification.producer';
import { NotificationDeliveryService } from './notification-delivery.service';
import { MobilePushModule } from '../mobile-push/mobile-push.module';
import { AccessPolicyModule } from '../access/access-policy.module';
import { NotificationEligibilityService } from './notification-eligibility.service';

/** 站内通知模块：CRUD、幂等持久化与移动推送衔接。 */
@Module({
  imports: [MobilePushModule, AccessPolicyModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEligibilityService,
    NotificationDeliveryService,
    NotificationProducer,
  ],
  exports: [NotificationsService, NotificationDeliveryService, NotificationProducer],
})
export class NotificationsModule {}
