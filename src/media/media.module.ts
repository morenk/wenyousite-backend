import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { UserMediaCleanupListener } from './user-media-cleanup.listener';
import { ImageProcessor } from './image.processor';
import { MediaReferenceModule } from './media-reference.module';
import { ObjectStorageModule } from '../storage/object-storage.module';

/** 媒体模块：预签名上传 + 上传确认 + 异步图片加工（缩略图/中图） */
@Module({
  imports: [BullModule.registerQueue({ name: 'image' }), MediaReferenceModule, ObjectStorageModule],
  controllers: [MediaController],
  providers: [MediaService, UserMediaCleanupListener, ImageProcessor],
  exports: [MediaService, MediaReferenceModule],
})
export class MediaModule {}
