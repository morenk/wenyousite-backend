import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxDispatcher } from './outbox.dispatcher';

describe('OutboxDispatcher', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    domainOutbox: { updateMany: jest.fn() },
  };
  const events = { emitAsync: jest.fn() };
  let dispatcher: OutboxDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.domainOutbox.updateMany.mockResolvedValue({ count: 1 });
    events.emitAsync.mockResolvedValue([]);
    dispatcher = new OutboxDispatcher(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );
  });

  it('等待所有监听器完成后确认事件', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'o1', eventType: 'post.created', payload: { postId: 'p1' }, attempts: 1 },
    ]);

    await dispatcher.dispatch();

    expect(events.emitAsync).toHaveBeenCalledWith('post.created', { postId: 'p1' });
    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null },
      data: { processedAt: expect.any(Date), lastError: null },
    });
  });

  it('监听器失败时保留未处理状态并安排退避重试', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'o1', eventType: 'post.created', payload: { postId: 'p1' }, attempts: 2 },
    ]);
    events.emitAsync.mockRejectedValue(new Error('listener failed'));

    await dispatcher.dispatch();

    expect(prisma.domainOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', processedAt: null },
      data: {
        lastError: 'listener failed',
        availableAt: expect.any(Date),
      },
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
});
