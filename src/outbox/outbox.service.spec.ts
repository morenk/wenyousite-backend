import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  it('按事件键幂等写入事务客户端', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'event-1' });
    const tx = { domainOutbox: { upsert } } as any;
    const service = new OutboxService();

    await service.enqueue(tx, {
      eventType: 'post.created',
      aggregateType: 'Post',
      aggregateId: 'post-1',
      eventKey: 'post-created:post-1',
      payload: { postId: 'post-1' },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { eventKey: 'post-created:post-1' },
      create: expect.objectContaining({
        eventType: 'post.created',
        aggregateId: 'post-1',
        payload: { postId: 'post-1' },
      }),
      update: {},
    });
  });
});
