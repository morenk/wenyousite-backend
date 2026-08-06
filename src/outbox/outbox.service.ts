import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface OutboxEvent {
  eventType: string;
  aggregateType: string;
  aggregateId?: string;
  eventKey: string;
  payload: Prisma.InputJsonValue;
}

type OutboxTransaction = Pick<Prisma.TransactionClient, 'domainOutbox'>;

/** 在业务事务中写入幂等领域事件。 */
@Injectable()
export class OutboxService {
  enqueue(tx: OutboxTransaction, event: OutboxEvent) {
    return tx.domainOutbox.upsert({
      where: { eventKey: event.eventKey },
      create: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventKey: event.eventKey,
        payload: event.payload,
      },
      update: {},
    });
  }
}
