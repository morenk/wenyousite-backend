import { Module } from '@nestjs/common';
import { MediaReferenceService } from './media-reference.service';

/** 轻量媒体引用账本模块，供领域写事务复用，不连带注册上传控制器和图片队列。 */
@Module({
  providers: [MediaReferenceService],
  exports: [MediaReferenceService],
})
export class MediaReferenceModule {}
