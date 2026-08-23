import { Module } from '@nestjs/common';
import { CleanupTask } from './cleanup.task';
import { MediaModule } from '../media/media.module';
import { StickersModule } from '../stickers/stickers.module';
import { MobilePushModule } from '../mobile-push/mobile-push.module';
import { MediaProcessingRecoveryService } from '../media/media-processing-recovery.service';

/** 后台维护模块：定时清理过期数据与孤儿媒体。 */
@Module({
  imports: [MediaModule, StickersModule, MobilePushModule],
  providers: [CleanupTask, MediaProcessingRecoveryService],
})
export class JobsModule {}
