import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MobilePushProducer } from '../mobile-push/mobile-push.producer';
import { NotificationProcessor } from './notification.processor';
import { NotificationJob } from './notification.producer';

function buildProcessor() {
  const tx = {
    notification: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    notification: {},
  };
  const pushes = { enqueue: jest.fn() };
  return {
    processor: new NotificationProcessor(
      prisma as unknown as PrismaService,
      pushes as unknown as MobilePushProducer,
    ),
    tx,
    prisma,
    pushes,
  };
}

describe('NotificationProcessor 点赞聚合', () => {
  it('首次点赞写入 eventKey，队列重试可识别该事件', async () => {
    const { processor, tx, pushes } = buildProcessor();
    tx.notification.findMany.mockResolvedValue([]);
    tx.notification.create.mockResolvedValue({
      id: 'notification1',
      eventKey: 'like:thread1:player1:owner1',
    });

    await processor.process({
      data: {
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
      },
    } as unknown as Job<NotificationJob>);

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
    const loggerLog = jest.spyOn(
      (processor as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
      'log',
    ).mockImplementation(() => undefined);
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

    await processor.process({
      data: {
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
      },
    } as unknown as Job<NotificationJob>);

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
    const { processor, tx } = buildProcessor();
    tx.notification.findMany.mockResolvedValue([
      {
        id: 'notification1',
        isRead: false,
        payload: { totalCount: 1, eventKeys: ['like:thread1:player1'] },
      },
    ]);

    await processor.process({
      data: {
        type: 'like',
        recipients: ['owner1'],
        content: '玩家1 赞了你的主题帖',
        threadId: 'thread1',
        eventKey: 'like:thread1:player1',
        payload: { likers: [{ userId: 'player1', username: '玩家1' }] },
      },
    } as unknown as Job<NotificationJob>);

    expect(tx.notification.update).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
