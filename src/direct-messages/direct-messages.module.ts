import { Module } from '@nestjs/common';
import { DirectConversationsController, DirectMessagesController } from './direct-messages.controller';
import { DirectMessageQueryService } from './direct-message-query.service';
import { DirectMessagesService } from './direct-messages.service';
import { StickersModule } from '../stickers/stickers.module';
import { OutboxModule } from '../outbox/outbox.module';
import { DirectMessageEventsService } from './direct-message-events.service';

@Module({
  imports: [StickersModule, OutboxModule],
  controllers: [DirectConversationsController, DirectMessagesController],
  providers: [DirectMessageQueryService, DirectMessageEventsService, DirectMessagesService],
  exports: [DirectMessageQueryService],
})
export class DirectMessagesModule {}
