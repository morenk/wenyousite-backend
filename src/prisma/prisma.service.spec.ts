import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from './prisma.service';
import { RedisService } from '../redis/redis.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';

describe('依赖关闭与 Outbox 排空的 Nest 生命周期', () => {
  afterEach(() => jest.restoreAllMocks());

  it('实际 Nest close 先等待正在进行的 Outbox 轮次完成，再断开 PG 和普通 Redis', async () => {
    const order: string[] = [];
    jest.spyOn(PrismaService.prototype, '$connect').mockResolvedValue(undefined);
    jest.spyOn(PrismaService.prototype, '$disconnect').mockImplementation(async () => {
      order.push('pg');
    });
    jest.spyOn(PrismaService.prototype, '$queryRaw').mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        RedisService,
        OutboxDispatcher,
        { provide: 'REDIS_CLIENT', useValue: { disconnect: () => order.push('redis') } },
        { provide: EventEmitter2, useValue: { listeners: () => [] } },
        { provide: 'cache-fixture', useValue: { onModuleDestroy: () => order.push('cache') } },
      ],
    }).compile();
    await module.init();
    const prisma = module.get(PrismaService);
    let release!: () => void;
    const listener = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatcher = module.get(OutboxDispatcher);
    jest.spyOn(prisma, '$queryRaw').mockReturnValueOnce(
      listener.then(() => {
        order.push('drained');
        return [];
      }) as ReturnType<PrismaService['$queryRaw']>,
    );
    const dispatch = dispatcher.dispatch();
    const closing = module.close();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(order).toEqual(['cache']);
    release();
    await Promise.all([dispatch, closing]);
    expect(order[1]).toBe('drained');
    expect(order.slice(2).sort()).toEqual(['pg', 'redis']);
  });
});
