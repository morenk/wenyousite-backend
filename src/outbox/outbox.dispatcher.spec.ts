import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxDispatcher } from './outbox.dispatcher';

describe('OutboxDispatcher', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    domainOutbox: { updateMany: jest.fn() },
  };
  const listener = jest.fn();
  const events = { listeners: jest.fn() };
  let dispatcher: OutboxDispatcher;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.domainOutbox.updateMany.mockResolvedValue({ count: 1 });
    listener.mockResolvedValue([]);
    events.listeners.mockReturnValue([listener]);
    dispatcher = new OutboxDispatcher(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );
    jest
      .spyOn(
        (dispatcher as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('等待所有监听器完成后确认事件', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'event-1', threadId: 'thread-1' },
        attempts: 1,
      },
    ]);

    await dispatcher.dispatch();

    expect(listener).toHaveBeenCalledWith({
      eventId: 'event-1',
      threadId: 'thread-1',
    });
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null, attempts: 1 },
      data: { processedAt: expect.any(Date), lastError: null },
    });
  });

  it('保留领域 listener 的 emitter 上下文、事件名和 once 包装行为', async () => {
    const emitter = new EventEmitter2();
    const seen: unknown[] = [];
    const once = jest.fn();
    emitter.on(
      'thread.unliked',
      function (this: EventEmitter2 & { event?: string }, payload: unknown) {
        expect(this).toBe(emitter);
        expect(this.event).toBe('thread.unliked');
        seen.push(payload);
      },
    );
    emitter.once('thread.unliked', once);
    const row = {
      id: 'o1',
      eventType: 'thread.unliked',
      payload: { eventId: 'e1', threadId: 't1' },
      attempts: 1,
    };
    prisma.$queryRaw.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ ...row, id: 'o2' }]);
    const target = new OutboxDispatcher(prisma as unknown as PrismaService, emitter);
    await target.dispatch();
    expect(seen).toHaveLength(2);
    expect(once).toHaveBeenCalledTimes(1);
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledTimes(2);
  });

  it('监听器失败时保留未处理状态并安排退避重试', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'event-1', threadId: 'thread-1' },
        attempts: 2,
      },
    ]);
    listener.mockRejectedValue(new Error('listener failed'));

    await dispatcher.dispatch();

    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null, attempts: 2 },
      data: {
        lastError: JSON.stringify({
          stage: 'delivery',
          errorType: 'Error',
          errorCode: 'operation_failed',
        }),
        availableAt: expect.any(Date),
      },
    });
  });

  it('没有消费者时保留事件并安排重试', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'event-1', threadId: 'thread-1' },
        attempts: 1,
      },
    ]);
    events.listeners.mockReturnValue([]);

    await dispatcher.dispatch();

    expect(listener).not.toHaveBeenCalled();
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null, attempts: 1 },
      data: {
        lastError: JSON.stringify({
          stage: 'listener',
          errorType: 'Error',
          errorCode: 'operation_failed',
        }),
        availableAt: expect.any(Date),
      },
    });
  });

  it('载荷不符合契约时保留事件并安排重试', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'o1', eventType: 'thread.unliked', payload: { threadId: '' }, attempts: 1 },
    ]);

    await dispatcher.dispatch();

    expect(listener).not.toHaveBeenCalled();
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null, attempts: 1 },
      data: {
        lastError: JSON.stringify({
          stage: 'payload',
          errorType: 'Error',
          errorCode: 'operation_failed',
        }),
        availableAt: expect.any(Date),
      },
    });
  });

  it.each([
    new Error('private-body token=private-marker'),
    new AggregateError([new Error('private-marker')], 'private-marker'),
    { message: 'private-marker', stack: 'private-marker', code: 'private-marker' },
    'private-marker',
    Object.assign(new Error('private-marker'), { code: 'P1001' }),
  ])('投递失败不在持久字段和日志记录原始异常', async (error) => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'e1', threadId: 't1' },
        attempts: 1,
      },
    ]);
    listener.mockRejectedValue(error);
    await dispatcher.dispatch();
    const logger = (dispatcher as unknown as { logger: { error: jest.Mock } }).logger;
    expect(JSON.stringify(prisma.domainOutbox.updateMany.mock.calls)).not.toContain(
      'private-marker',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-marker');
    expect(prisma.domainOutbox.updateMany.mock.calls[0][0].data.processedAt).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'delivery', outboxId: 'o1', attempt: 1 }),
    );
  });

  it('初始化领取失败也使用相同脱敏诊断', async () => {
    prisma.$queryRaw.mockRejectedValue(
      Object.assign(new Error('private-marker'), { code: 'private-marker' }),
    );
    dispatcher.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    const logger = (dispatcher as unknown as { logger: { error: jest.Mock } }).logger;
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-marker');
    expect(logger.error).toHaveBeenCalledWith({
      stage: 'initial',
      errorType: 'Error',
      errorCode: 'operation_failed',
    });
  });

  it('同一实例已有分发任务时跳过重入', async () => {
    let release!: () => void;
    prisma.$queryRaw.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );

    const first = dispatcher.dispatch();
    await Promise.resolve();
    await dispatcher.dispatch();
    release();
    await first;

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('停机时等待当前监听器完成且不再领取新事件', async () => {
    let release!: () => void;
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'event-1', threadId: 'thread-1' },
        attempts: 1,
      },
    ]);
    listener.mockImplementation(() => new Promise((resolve) => (release = () => resolve([]))));

    const dispatch = dispatcher.dispatch();
    await Promise.resolve();
    const shutdown = dispatcher.beforeApplicationShutdown();
    await Promise.resolve();

    expect(prisma.domainOutbox.updateMany).not.toHaveBeenCalled();
    release();
    await Promise.all([dispatch, shutdown]);
    await dispatcher.dispatch();

    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null, attempts: 1 },
      data: { processedAt: expect.any(Date), lastError: null },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('停机等待中的领取失败不会阻止应用关闭', async () => {
    const databaseError = Object.assign(new Error('private database detail'), { code: 'P1001' });
    prisma.$queryRaw.mockRejectedValue(databaseError);

    const dispatchResult = dispatcher.dispatch().catch((error) => error);
    await expect(dispatcher.beforeApplicationShutdown()).resolves.toBeUndefined();

    await expect(dispatchResult).resolves.toBe(databaseError);
    const logger = (dispatcher as unknown as { logger: { error: jest.Mock } }).logger;
    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).toContain('P1001');
    expect(serialized).not.toContain('private database detail');
  });
  it.each(['claim', 'retry-update'])(
    '定时入口截断 %s 原始异常，不交给调度器打印',
    async (boundary) => {
      const failure = Object.assign(new Error('private-marker'), { code: 'P1001' });
      if (boundary === 'claim') prisma.$queryRaw.mockRejectedValue(failure);
      else {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: 'o1',
            eventType: 'thread.unliked',
            payload: { eventId: 'e1', threadId: 't1' },
            attempts: 1,
          },
        ]);
        listener.mockRejectedValue(new Error('private-marker'));
        prisma.domainOutbox.updateMany.mockRejectedValue(failure);
      }
      await expect(dispatcher.scheduledDispatch()).resolves.toBeUndefined();
      const logger = (dispatcher as unknown as { logger: { error: jest.Mock } }).logger;
      expect(logger.error).toHaveBeenCalledWith({
        stage: 'scheduled',
        errorType: 'Error',
        errorCode: 'P1001',
      });
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-marker');
    },
  );

  it('快失败不提前重试，等待同次慢监听器后才更新领取尝试', async () => {
    let release!: () => void;
    const slow = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    events.listeners.mockReturnValue([
      () => {
        throw new Error('failed');
      },
      slow,
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'e1', threadId: 't1' },
        attempts: 7,
      },
    ]);
    const pending = dispatcher.dispatch();
    while (!release) await Promise.resolve();
    await Promise.resolve();
    expect(prisma.domainOutbox.updateMany).not.toHaveBeenCalled();
    release();
    await pending;
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', processedAt: null, attempts: 7 },
      }),
    );
  });

  it('仅在当前投递结束后领取下一条，不提前消耗整批租约', async () => {
    let release!: () => void;
    listener.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'o1',
        eventType: 'thread.unliked',
        payload: { eventId: 'e1', threadId: 't1' },
        attempts: 1,
      },
    ]);
    const pending = dispatcher.dispatch();
    while (!release) await Promise.resolve();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain(1);
  });
});
