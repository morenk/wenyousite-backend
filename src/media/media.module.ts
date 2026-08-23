import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { UserMediaCleanupListener } from './user-media-cleanup.listener';
import { MediaReferenceModule } from './media-reference.module';
import { ObjectStorageModule } from '../storage/object-storage.module';
import { MediaProcessingService } from './media-processing.service';

/** 媒体模块：预签名上传 + 上传确认 + 异步图片加工（缩略图/中图） */
@Module({
  imports: [BullModule.registerQueue({ name: 'image' }), MediaReferenceModule, ObjectStorageModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaProcessingService,
    UserMediaCleanupListener,
  ],
  exports: [BullModule, MediaService, MediaProcessingService, MediaReferenceModule],
})
export class MediaModule {}
