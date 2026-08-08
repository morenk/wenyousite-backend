import { OutboxService } from '../outbox/outbox.service';
import { DirectMessageEventsService } from './direct-message-events.service';

describe('DirectMessageEventsService', () => {
  it('在消息事务中写入隐私安全且可幂等消费的 outbox 事件', async () => {
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const tx = { outboxEvent: { create: jest.fn() } };
    const service = new DirectMessageEventsService(outbox as unknown as OutboxService);
    const event = { messageId: 'm1', conversationId: 'c1', recipientId: 'u2' };

    await service.created(tx as never, event);

    expect(outbox.enqueue).toHaveBeenCalledWith(tx, {
      eventType: 'direct-message.created',
      aggregateType: 'DirectMessage',
      aggregateId: 'm1',
      eventKey: 'direct-message-created:m1',
      payload: event,
    });
    expect(outbox.enqueue.mock.calls[0][1].payload).not.toHaveProperty('content');
  });
});
