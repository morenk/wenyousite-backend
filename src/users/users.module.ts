import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersFollowController } from './users-follow.controller';
import { UsersService } from './users.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookmarksModule } from '../bookmarks/bookmarks.module';
import { ThreadsModule } from '../threads/threads.module';
import { MentionsModule } from '../mentions/mentions.module';
import { MomentsModule } from '../moments/moments.module';
import { UserRelationsService } from './user-relations.service';
import { UserActivityService } from './user-activity.service';
import { AccessPolicyModule } from '../access/access-policy.module';
import { OutboxModule } from '../outbox/outbox.module';
import { UserRelationEventsListener } from './user-relation-events.listener';

/** 用户模块：资料查询、关注、拉黑 */
@Module({
  imports: [
    AccessPolicyModule,
    NotificationsModule,
    BookmarksModule,
    ThreadsModule,
    MentionsModule,
    MomentsModule,
    OutboxModule,
  ],
  controllers: [UsersController, UsersFollowController],
  providers: [UsersService, UserRelationsService, UserActivityService, UserRelationEventsListener],
  exports: [UsersService, UserRelationsService, UserActivityService],
})
export class UsersModule {}
