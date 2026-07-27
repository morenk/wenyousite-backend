import { Module } from '@nestjs/common';
import { ThreadsController } from './threads.controller';
import { ThreadMembersController } from './thread-members.controller';
import { ThreadTagsController } from './thread-tags.controller';
import { ThreadsService } from './threads.service';
import { ThreadMembersService } from './thread-members.service';
import { TagsModule } from '../tags/tags.module';
import { TagsService } from '../tags/tags.service';

/** 主题帖模块：CRUD、成员管理、标签关联 */
@Module({
  imports: [TagsModule],
  controllers: [ThreadsController, ThreadMembersController, ThreadTagsController],
  providers: [ThreadsService, ThreadMembersService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
