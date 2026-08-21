import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccessPolicyModule } from '../access/access-policy.module';
import { ObjectStorageModule } from '../storage/object-storage.module';
import { StickerContentService } from './sticker-content.service';
import { StickerProcessor } from './sticker.processor';
import { StickerStorageService } from './sticker-storage.service';
import { StickersController } from './stickers.controller';
import { StickersService } from './stickers.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'sticker' }), AccessPolicyModule, ObjectStorageModule],
  controllers: [StickersController],
  providers: [StickersService, StickerContentService, StickerStorageService, StickerProcessor],
  exports: [StickersService, StickerContentService],
})
export class StickersModule {}
