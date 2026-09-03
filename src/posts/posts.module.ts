import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { MentionsModule } from '../mentions/mentions.module';
import { PostQueryService } from './post-query.service';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessPolicyModule } from '../access/access-policy.module';
import { StickersModule } from '../stickers/stickers.module';
import { MediaReferenceModule } from '../media/media-reference.module';
import { DiceModule } from '../dice/dice.module';
import { PostMentionEventsService } from './post-mention-events.service';
import { PostPinService } from './post-pin.service';

/** 楼层模块：发帖、楼中楼、编辑、软删除 */
@Module({
  imports: [
    AccessPolicyModule,
    OutboxModule,
    MentionsModule,
    StickersModule,
    MediaReferenceModule,
    DiceModule,
  ],
  controllers: [PostsController],
  providers: [PostsService, PostQueryService, PostMentionEventsService, PostPinService],
  exports: [PostsService],
})
export class PostsModule {}
