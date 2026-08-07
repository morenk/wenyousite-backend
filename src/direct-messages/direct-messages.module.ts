import { Module } from '@nestjs/common';
import { DirectConversationsController, DirectMessagesController } from './direct-messages.controller';
import { DirectMessageQueryService } from './direct-message-query.service';
import { DirectMessagesService } from './direct-messages.service';

@Module({
  controllers: [DirectConversationsController, DirectMessagesController],
  providers: [DirectMessageQueryService, DirectMessagesService],
  exports: [DirectMessageQueryService],
})
export class DirectMessagesModule {}
