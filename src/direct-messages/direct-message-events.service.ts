import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';

/** 私聊领域事件写入器：事件与消息共用事务，供推送等异步消费者可靠处理。 */
@Injectable()
export class DirectMessageEventsService {
  constructor(private readonly outbox: OutboxService) {}

  async created(
    tx: Prisma.TransactionClient,
    event: { messageId: string; conversationId: string; recipientId: string },
  ) {
    await this.outbox.enqueue(tx, {
      eventType: 'direct-message.created',
      aggregateType: 'DirectMessage',
      aggregateId: event.messageId,
      eventKey: `direct-message-created:${event.messageId}`,
      payload: event as Prisma.InputJsonValue,
    });
  }
}
