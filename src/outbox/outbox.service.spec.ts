import type { Prisma } from '@prisma/client';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  it('按事件键幂等写入事务客户端', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'event-1' });
    const tx = { domainOutbox: { upsert } } as unknown as Pick<
      Prisma.TransactionClient,
      'domainOutbox'
    >;
    const service = new OutboxService();

    await service.enqueue(tx, {
      eventType: 'thread.unliked',
      aggregateType: 'Thread',
      aggregateId: 'thread-1',
      eventKey: 'thread-unliked:thread-1:event-1',
      payload: { eventId: 'event-1', threadId: 'thread-1' },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { eventKey: 'thread-unliked:thread-1:event-1' },
      create: expect.objectContaining({
        eventType: 'thread.unliked',
        aggregateId: 'thread-1',
        payload: { eventId: 'event-1', threadId: 'thread-1' },
      }),
      update: {},
    });
  });
});
