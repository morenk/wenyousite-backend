import { Module } from '@nestjs/common';
import { BookmarksModule } from '../bookmarks/bookmarks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { StickersModule } from '../stickers/stickers.module';
import { MomentCommentsService } from './moment-comments.service';
import { MomentBookmarksService } from './moment-bookmarks.service';
import { MomentEventsListener } from './moment-events.listener';
import { MomentsController, UserMomentsController } from './moments.controller';
import { MomentsService } from './moments.service';
import { MediaReferenceModule } from '../media/media-reference.module';

@Module({
  imports: [
    BookmarksModule,
    NotificationsModule,
    OutboxModule,
    StickersModule,
    MediaReferenceModule,
  ],
  controllers: [MomentsController, UserMomentsController],
  providers: [MomentsService, MomentBookmarksService, MomentCommentsService, MomentEventsListener],
  exports: [MomentsService, MomentBookmarksService],
})
export class MomentsModule {}
