import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { MentionsModule } from '../mentions/mentions.module';
import { JobsModule } from '../jobs/jobs.module';

/** 楼层模块：发帖、楼中楼、编辑、软删除 */
@Module({
  imports: [MentionsModule, JobsModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
