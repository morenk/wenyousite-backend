import { AudioRuntimeModule } from './audio-runtime.service';
import { AudioProcessingService } from './audio-processing.service';
import { AudioProjectionService } from './audio-projection.service';
import { ThreadIdentitiesModule } from '../thread-identities/thread-identities.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MediaDisplayInterceptor } from './media-display.interceptor';
import { MediaDisplayProjectionService } from './media-display-projection.service';
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
  imports: [
    AudioRuntimeModule,
    ThreadIdentitiesModule,
    BullModule.registerQueue({ name: 'image' }),
    MediaReferenceModule,
    ObjectStorageModule,
  ],
  controllers: [MediaController],
  providers: [
    AudioProcessingService,
    AudioProjectionService,
    MediaDisplayProjectionService,
    { provide: APP_INTERCEPTOR, useClass: MediaDisplayInterceptor },
    MediaService,
    MediaProcessingService,
    UserMediaCleanupListener,
  ],
  exports: [
    AudioProcessingService,
    BullModule,
    MediaService,
    MediaProcessingService,
    MediaReferenceModule,
  ],
})
export class MediaModule {}
