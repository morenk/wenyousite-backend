import { Module } from '@nestjs/common';
import { SubthreadsController } from './subthreads.controller';
import { SubthreadTagsController } from './subthread-tags.controller';
import { SubthreadsService } from './subthreads.service';

/** 子贴模块：CRUD、排序、标签 */
@Module({
  controllers: [SubthreadsController, SubthreadTagsController],
  providers: [SubthreadsService],
  exports: [SubthreadsService],
})
export class SubthreadsModule {}
