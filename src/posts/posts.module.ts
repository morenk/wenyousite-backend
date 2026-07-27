import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { MentionsModule } from '../mentions/mentions.module';

/** 楼层模块：发帖、楼中楼、编辑、软删除 */
@Module({
  imports: [MentionsModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
