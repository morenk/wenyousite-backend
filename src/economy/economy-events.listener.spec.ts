import { EconomyEventsListener } from './economy-events.listener';

function buildListener() {
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    hset: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({
      views: '10',
      replies: '2',
      likes: '3',
      tips: '12',
      createdAt: String(Date.now() - 3_600_000),
    }),
    zadd: jest.fn().mockResolvedValue(1),
  };
  const events = { emit: jest.fn() };
  return {
    listener: new EconomyEventsListener(notifications as never, redis as never, events as never),
    notifications,
    redis,
    events,
  };
}

const userTip = {
  transactionId: 'transaction-1',
  senderId: 'sender-1',
  senderUsername: '打赏者',
  recipientId: 'recipient-1',
  targetType: 'USER' as const,
  grossAmount: '10',
  recipientAmount: '8',
  platformAmount: '2',
};

describe('EconomyEventsListener', () => {
  it('用户打赏生成带稳定事件键的通知，不触碰主题缓存', async () => {
    const { listener, notifications, redis, events } = buildListener();

    await listener.handleTipCompleted(userTip);

    expect(notifications.notify).toHaveBeenCalledWith(
      'tip',
      ['recipient-1'],
      '打赏者 向你打赏了 10 升温油（到账 8 升）',
      expect.objectContaining({
        fromUserId: 'sender-1',
        eventKey: 'tip:transaction-1',
        payload: expect.objectContaining({
          schemaVersion: 1,
          action: 'tip',
          grossAmount: '10',
          recipientAmount: '8',
          platformAmount: '2',
        }),
      }),
    );
    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('主题打赏使用权威累计值覆盖 Redis 并刷新智能排序', async () => {
    const { listener, notifications, redis, events } = buildListener();

    await listener.handleTipCompleted({
      ...userTip,
      targetType: 'THREAD',
      threadId: 'thread-1',
      threadTitle: '测试主题',
      threadTipTotal: '12',
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'tip',
      ['recipient-1'],
      '打赏者 向你的主题帖「测试主题」打赏了 10 升温油（到账 8 升）',
      expect.objectContaining({ threadId: 'thread-1', eventKey: 'tip:transaction-1' }),
    );
    expect(redis.hset).toHaveBeenCalledWith('thread:thread-1:stats', 'tips', '12');
    expect(redis.hgetall).toHaveBeenCalledWith('thread:thread-1:stats');
    expect(redis.zadd).toHaveBeenCalledWith('threads:by:smart', expect.any(Number), 'thread-1');
    expect(events.emit).toHaveBeenCalledWith('thread.updated', { threadId: 'thread-1' });
  });

  it('通知入队失败时向上抛出，使 Outbox 保留事件等待重试', async () => {
    const { listener, notifications, redis, events } = buildListener();
    notifications.notify.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(
      listener.handleTipCompleted({
        ...userTip,
        targetType: 'THREAD',
        threadId: 'thread-1',
        threadTipTotal: '12',
      }),
    ).rejects.toThrow('queue unavailable');
    expect(redis.hset).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
