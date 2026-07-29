import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ReadingProgressModule } from '../reading-progress/reading-progress.module';
import { JobsModule } from '../jobs/jobs.module';
import { MentionsModule } from '../mentions/mentions.module';

/** 楼层模块：发帖、楼中楼、编辑、软删除（通知走 EventEmitter，进度走 ReadingProgress） */
@Module({
  imports: [ReadingProgressModule, JobsModule, MentionsModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
