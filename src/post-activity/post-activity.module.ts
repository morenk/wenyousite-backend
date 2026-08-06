import { Module } from '@nestjs/common';
import { MentionsModule } from '../mentions/mentions.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccessPolicyModule } from '../access/access-policy.module';
import { PostEventsListener } from './post-events.listener';

/** 帖子活动投影：提及、订阅通知和 Redis 排行统计。 */
@Module({
  imports: [
    MentionsModule,
    SubscriptionsModule,
    NotificationsModule,
    AccessPolicyModule,
  ],
  providers: [PostEventsListener],
})
export class PostActivityModule {}
