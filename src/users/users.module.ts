import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersFollowController } from './users-follow.controller';
import { UsersService } from './users.service';
import { JobsModule } from '../jobs/jobs.module';
import { BookmarksModule } from '../bookmarks/bookmarks.module';
import { ThreadsModule } from '../threads/threads.module';

/** 用户模块：资料查询、关注、拉黑 */
@Module({
  imports: [JobsModule, BookmarksModule, ThreadsModule],
  controllers: [UsersController, UsersFollowController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
