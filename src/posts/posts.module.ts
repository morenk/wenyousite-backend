import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ReadingProgressModule } from '../reading-progress/reading-progress.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MentionsModule } from '../mentions/mentions.module';
import { PostingPolicyService } from './posting-policy.service';
import { PostQueryService } from './post-query.service';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessPolicyModule } from '../access/access-policy.module';

/** 楼层模块：发帖、楼中楼、编辑、软删除（通知走 EventEmitter，进度走 ReadingProgress） */
@Module({
  imports: [
    AccessPolicyModule,
    OutboxModule,
    ReadingProgressModule,
    NotificationsModule,
    MentionsModule,
  ],
  controllers: [PostsController],
  providers: [PostsService, PostingPolicyService, PostQueryService],
  exports: [PostsService],
})
export class PostsModule {}
