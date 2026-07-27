import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersFollowController } from './users-follow.controller';
import { UsersService } from './users.service';

/** 用户模块：资料查询、关注、拉黑 */
@Module({
  controllers: [UsersController, UsersFollowController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
