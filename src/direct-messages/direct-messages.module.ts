import { Module } from '@nestjs/common';
import { DirectConversationsController, DirectMessagesController } from './direct-messages.controller';
import { DirectMessageQueryService } from './direct-message-query.service';
import { DirectMessagesService } from './direct-messages.service';
import { StickersModule } from '../stickers/stickers.module';

@Module({
  imports: [StickersModule],
  controllers: [DirectConversationsController, DirectMessagesController],
  providers: [DirectMessageQueryService, DirectMessagesService],
  exports: [DirectMessageQueryService],
})
export class DirectMessagesModule {}
