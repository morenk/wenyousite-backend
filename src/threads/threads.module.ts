import { Module } from '@nestjs/common';
import { ThreadsController } from './threads.controller';
import { ThreadMembersController } from './thread-members.controller';
import { ThreadTagsController } from './thread-tags.controller';
import { ThreadsService } from './threads.service';
import { ThreadMembersService } from './thread-members.service';
import { TagsModule } from '../tags/tags.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadTagsService } from './thread-tags.service';
import { ThreadQueryService } from './thread-query.service';
import { AccessPolicyModule } from '../access/access-policy.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ThreadEventsListener } from './thread-events.listener';
import { ThreadAggregateService } from './thread-aggregate.service';
import { MentionsModule } from '../mentions/mentions.module';
import { StickersModule } from '../stickers/stickers.module';
import { ThreadCreateIdempotencyService } from './thread-create-idempotency.service';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';

/** 主题帖模块：CRUD、参与人管理、标签关联 */
@Module({
  imports: [
    AccessPolicyModule,
    TagsModule,
    NotificationsModule,
    OutboxModule,
    MentionsModule,
    StickersModule,
    TaxonomyModule,
  ],
  controllers: [ThreadsController, ThreadMembersController, ThreadTagsController],
  providers: [
    ThreadsService,
    ThreadMembersService,
    ThreadTagsService,
    ThreadQueryService,
    ThreadCreateIdempotencyService,
    ThreadEventsListener,
    ThreadAggregateService,
  ],
  exports: [ThreadsService],
})
export class ThreadsModule {}
