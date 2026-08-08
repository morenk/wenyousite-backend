import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { StickersModule } from '../stickers/stickers.module';
import { MomentCommentsService } from './moment-comments.service';
import { MomentEventsListener } from './moment-events.listener';
import { MomentsController, UserMomentsController } from './moments.controller';
import { MomentsService } from './moments.service';

@Module({
  imports: [NotificationsModule, OutboxModule, StickersModule],
  controllers: [MomentsController, UserMomentsController],
  providers: [MomentsService, MomentCommentsService, MomentEventsListener],
  exports: [MomentsService],
})
export class MomentsModule {}
