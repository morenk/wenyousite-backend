import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainEventName, DomainEventPayload } from './domain-events';

export interface OutboxEvent<K extends DomainEventName> {
  eventType: K;
  aggregateType: string;
  aggregateId?: string;
  eventKey: string;
  payload: DomainEventPayload<K>;
}

type OutboxTransaction = Pick<Prisma.TransactionClient, 'domainOutbox'>;

/** 在业务事务中写入幂等领域事件。 */
@Injectable()
export class OutboxService {
  enqueue<K extends DomainEventName>(tx: OutboxTransaction, event: OutboxEvent<K>) {
    return tx.domainOutbox.upsert({
      where: { eventKey: event.eventKey },
      create: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventKey: event.eventKey,
        payload: event.payload as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}
