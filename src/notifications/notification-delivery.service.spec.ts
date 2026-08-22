import { PrismaService } from '../prisma/prisma.service';
import { MobilePushProducer } from '../mobile-push/mobile-push.producer';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationJob } from './notification.producer';

function buildProcessor() {
  const tx = {
    notification: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const notification = {
    findMany: jest.fn(),
    createMany: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    notification,
  };
  const pushes = { enqueue: jest.fn() };
  return {
    processor: new NotificationDeliveryService(
      prisma as unknown as PrismaService,
      pushes as unknown as MobilePushProducer,
    ),
    tx,
    prisma,
    notification,
    pushes,
  };
}

describe('NotificationDeliveryService 点赞聚合', () => {
  it('首次点赞写入 eventKey，Outbox 重放可识别该事件', async () => {
    const { processor, tx, pushes } = buildProcessor();
    tx.notification.findMany.mockResolvedValue([]);
    tx.notification.create.mockResolvedValue({
      id: 'notification1',
      eventKey: 'like:thread1:player1:owner1',
    });

    await processor.deliver({
      type: 'like',
      recipients: ['owner1'],
      content: '玩家1 赞了你的主题帖「测试帖」',
      threadId: 'thread1',
      fromUserId: 'player1',
      eventKey: 'like:thread1:player1',
      payload: {
        action: 'like',
        actorName: '玩家1',
        threadTitle: '测试帖',
        totalCount: 1,
        likers: [{ userId: 'player1', username: '玩家1' }],
      },
    });

    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ eventKeys: ['like:thread1:player1'] }),
        }),
      }),
    );
    expect(pushes.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'notification1', userId: 'owner1' }),
    );
  });

  it('未读点赞聚合在事务中累加人数并保留主题帖标题', async () => {
    const { processor, tx } = buildProcessor();
    const loggerLog = jest
      .spyOn(
        (processor as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    tx.notification.findMany.mockResolvedValue([
      {
        id: 'notification1',
        isRead: false,
        payload: {
          action: 'like',
          actorName: '玩家1',
          threadTitle: '测试帖',
          totalCount: 1,
          likers: [{ userId: 'player1', username: '玩家1' }],
        },
      },
    ]);

    await processor.deliver({
      type: 'like',
      recipients: ['owner1'],
      content: '玩家2 赞了你的主题帖「测试帖」',
      threadId: 'thread1',
      fromUserId: 'player2',
      eventKey: 'like:thread1:player2',
      payload: {
        actorName: '玩家2',
        threadTitle: '测试帖',
        likers: [{ userId: 'player2', username: '玩家2' }],
      },
    });

    expect(tx.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification1' },
        data: expect.objectContaining({
          content: '玩家1、玩家2 赞了你的主题帖「测试帖」',
          payload: expect.objectContaining({ totalCount: 2, eventKeys: ['like:thread1:player2'] }),
        }),
      }),
    );
    expect(loggerLog).toHaveBeenCalled();
    loggerLog.mockRestore();
  });

  it('已处理的点赞事件重试不会再次累加', async () => {
    const { processor, tx, pushes } = buildProcessor();
    tx.notification.findMany.mockResolvedValue([
      {
        id: 'notification1',
        isRead: false,
        payload: { totalCount: 1, eventKeys: ['like:thread1:player1'] },
      },
    ]);

    await processor.deliver({
      type: 'like',
      recipients: ['owner1'],
      content: '玩家1 赞了你的主题帖',
      threadId: 'thread1',
      eventKey: 'like:thread1:player1',
      payload: { likers: [{ userId: 'player1', username: '玩家1' }] },
    });

    expect(tx.notification.update).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(pushes.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'notification1', userId: 'owner1' }),
    );
  });

  it('点赞通知已提交但推送入队失败时，后续幂等重放不会重复聚合', async () => {
    const { processor, tx, pushes } = buildProcessor();
    const job: NotificationJob = {
      type: 'like',
      recipients: ['owner1'],
      content: '玩家1 赞了你的主题帖',
      threadId: 'thread1',
      eventKey: 'like:thread1:player1',
      payload: { likers: [{ userId: 'player1', username: '玩家1' }] },
    };
    tx.notification.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'notification1',
        isRead: false,
        payload: { totalCount: 1, eventKeys: ['like:thread1:player1'] },
      },
    ]);
    tx.notification.create.mockResolvedValue({
      id: 'notification1',
      eventKey: 'like:thread1:player1:owner1',
    });
    pushes.enqueue
      .mockRejectedValueOnce(new Error('redis unavailable after commit'))
      .mockResolvedValueOnce(undefined);

    await expect(processor.deliver(job)).resolves.toBeUndefined();
    await expect(processor.deliver(job)).resolves.toBeUndefined();

    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.update).not.toHaveBeenCalled();
    expect(pushes.enqueue).toHaveBeenCalledTimes(2);
  });
});

describe('NotificationDeliveryService 普通通知', () => {
  it('通知已入库但推送入队失败时，后续幂等重放复用权威通知', async () => {
    const { processor, notification, pushes } = buildProcessor();
    const stored = {
      id: 'notification1',
      userId: 'owner1',
      eventKey: 'reply:post1:owner1',
    };
    notification.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([stored])
      .mockResolvedValueOnce([stored])
      .mockResolvedValueOnce([stored]);
    notification.createMany.mockResolvedValue({ count: 1 });
    pushes.enqueue
      .mockRejectedValueOnce(new Error('redis unavailable after commit'))
      .mockResolvedValueOnce(undefined);
    const job: NotificationJob = {
      type: 'reply',
      recipients: ['owner1'],
      content: '有人回复了你',
      postId: 'post1',
      eventKey: 'reply:post1',
    };

    await expect(processor.deliver(job)).resolves.toBeUndefined();
    await expect(processor.deliver(job)).resolves.toBeUndefined();

    expect(notification.createMany).toHaveBeenCalledTimes(1);
    expect(pushes.enqueue).toHaveBeenCalledTimes(2);
    expect(pushes.enqueue).toHaveBeenLastCalledWith({
      userId: 'owner1',
      kind: 'notification',
      eventKey: 'notification:reply:post1:owner1',
      notificationId: 'notification1',
    });
  });

  it('拒绝未知通知类型，避免调用方确认未投递事件', async () => {
    const { processor } = buildProcessor();
    await expect(
      processor.deliver({
        type: 'future_type',
        recipients: ['owner1'],
        content: '未知通知',
      } as never),
    ).rejects.toThrow('Unsupported notification type: future_type');
  });
});
