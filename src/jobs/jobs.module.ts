import { Module } from '@nestjs/common';
import { CleanupTask } from './cleanup.task';
import { MediaModule } from '../media/media.module';

/** 后台维护模块：定时清理过期数据与孤儿媒体。 */
@Module({
  imports: [MediaModule],
  providers: [CleanupTask],
})
export class JobsModule {}
