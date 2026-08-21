import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MobilePushProducer } from './mobile-push.producer';
import { DOMAIN_EVENTS, DirectMessageCreatedEvent } from '../outbox/domain-events';

@Injectable()
export class DirectMessagePushListener {
  constructor(private readonly pushes: MobilePushProducer) {}

  @OnEvent(DOMAIN_EVENTS.DIRECT_MESSAGE_CREATED)
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
