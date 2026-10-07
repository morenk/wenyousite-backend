import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { ExperienceEventsListener } from '../progression/experience-events.listener';
import { ProgressionService } from '../progression/progression.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxDispatcher } from './outbox.dispatcher';

it('真实 Nest 监听器的失败传回 Outbox，重试成功前不得确认', async () => {
  const grants = jest.fn().mockRejectedValueOnce(new Error('grant failed')).mockResolvedValue(undefined);
  const module = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      ExperienceEventsListener,
      { provide: ProgressionService, useValue: { grantMany: grants } },
      { provide: NotificationProducer, useValue: { notify: jest.fn() } },
    ],
  }).compile();
  await module.init();
  const row = {
    id: 'event-1', eventType: 'moment.created', attempts: 1,
    payload: { momentId: 'moment-1', authorId: 'user-1', occurredAt: '2026-09-05T12:00:00.000Z' },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]).mockResolvedValueOnce([row]),
    domainOutbox: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const dispatcher = new OutboxDispatcher(prisma as unknown as PrismaService, module.get(EventEmitter2));
  const log = jest.spyOn(
    (dispatcher as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
    'error',
  ).mockImplementation(() => undefined);
  try {
    await dispatcher.dispatch();
    expect(grants).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.domainOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'event-1', processedAt: null, attempts: 1 },
      data: { lastError: JSON.stringify({ stage: 'delivery', errorType: 'Error', errorCode: 'operation_failed' }), availableAt: expect.any(Date) },
    });
    // 退避结束后的下一轮重新领取，数据库增加 attempts；本轮领取后仍返回空结果。
    prisma.$queryRaw.mockResolvedValueOnce([{ ...row, attempts: 2 }]);
    await dispatcher.dispatch();
    expect(grants).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(grants.mock.calls[0]).toEqual(grants.mock.calls[1]);
    expect(prisma.domainOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'event-1', processedAt: null, attempts: 2 },
      data: { processedAt: expect.any(Date), lastError: null },
    });
  } finally {
    log.mockRestore();
    await module.close();
  }
});
