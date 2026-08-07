import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MobileDeviceController } from './mobile-device.controller';
import { MobileDeviceService } from './mobile-device.service';
import { FirebasePushProvider } from './firebase-push.provider';
import { MobilePushProducer } from './mobile-push.producer';
import { MobilePushProcessor } from './mobile-push.processor';
import { DirectMessagePushListener } from './direct-message-push.listener';

@Module({
  imports: [BullModule.registerQueue({ name: 'mobile-push' })],
  controllers: [MobileDeviceController],
  providers: [
    MobileDeviceService,
    FirebasePushProvider,
    MobilePushProducer,
    MobilePushProcessor,
    DirectMessagePushListener,
  ],
  exports: [MobileDeviceService, MobilePushProducer],
})
export class MobilePushModule {}
