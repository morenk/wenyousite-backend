import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** 媒体模块：预签名上传 + 上传确认 + 异步图片加工（缩略图/中图） */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'image' }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
