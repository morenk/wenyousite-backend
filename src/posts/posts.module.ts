import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { MentionsModule } from '../mentions/mentions.module';
import { PostingPolicyService } from './posting-policy.service';
import { PostQueryService } from './post-query.service';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessPolicyModule } from '../access/access-policy.module';
import { StickersModule } from '../stickers/stickers.module';
import { MediaReferenceModule } from '../media/media-reference.module';

/** 楼层模块：发帖、楼中楼、编辑、软删除 */
@Module({
  imports: [AccessPolicyModule, OutboxModule, MentionsModule, StickersModule, MediaReferenceModule],
  controllers: [PostsController],
  providers: [PostsService, PostingPolicyService, PostQueryService],
  exports: [PostsService],
})
export class PostsModule {}
