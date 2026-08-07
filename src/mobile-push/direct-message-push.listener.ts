import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MobilePushProducer } from './mobile-push.producer';

interface DirectMessageCreatedEvent {
  messageId: string;
  conversationId: string;
  recipientId: string;
}

@Injectable()
export class DirectMessagePushListener {
  constructor(private readonly pushes: MobilePushProducer) {}

  @OnEvent('direct-message.created')
  handle(event: DirectMessageCreatedEvent) {
    return this.pushes.enqueue({
      userId: event.recipientId,
      kind: 'direct_message',
      eventKey: `direct-message:${event.messageId}`,
      conversationId: event.conversationId,
      messageId: event.messageId,
    });
  }
}
