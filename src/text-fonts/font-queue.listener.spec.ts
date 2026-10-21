import { FontQueueListener } from './font-queue.listener';
import { Queue, Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { FontWorkDirectoryService } from './font-work-directory.service';
import { FontProcessor } from './font.processor';
import { FontProcessingService } from './font-processing.service';
import { FontProcessingFailure } from './font-sandbox.service';

const jobId = 'tfj_' + 'a'.repeat(32);
function setup() {
  const queue = { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) };
  const tx = {
    $queryRaw: jest.fn(),
    textFontBuildJob: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: jobId, attempt: 2 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const queued = jest.fn().mockResolvedValue([]);
  const prisma = {
    ...tx,
    textFontBuildJob: { ...tx.textFontBuildJob, findMany: queued },
    $transaction: jest.fn(async (body: (value: typeof tx) => Promise<unknown>) => body(tx)),
  };
  const work = { abandoned: jest.fn().mockResolvedValue([]), remove: jest.fn() },
    outbox = { enqueue: jest.fn() };
  const service = new FontQueueListener(
    queue as unknown as Queue,
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
    work as unknown as FontWorkDirectoryService,
  );
  return { queue, tx, queued, prisma, work, outbox, service };
}
function ticket(kind = 'build') {
  return { root: '/registered-work', ownership: { kind, jobId, attempt: 1, claim: 'claim' } };
}

describe('字体 Outbox 重投与失联 Worker 恢复', () => {
  it('重复 Outbox 使用相同作业键且保留有界重试', async () => {
    const s = setup(),
      event = { jobId, attempt: 1 };
    await s.service.enqueue(event);
    await s.service.enqueue(event);
    expect(s.queue.add.mock.calls[0]).toEqual(s.queue.add.mock.calls[1]);
    expect(s.queue.add).toHaveBeenCalledWith(
      'build',
      event,
      expect.objectContaining({
        jobId: `${jobId}-1`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });
  it('失联目录仅在已登记作业核验后清理，claim 相符才创建下一 attempt', async () => {
    const s = setup(),
      item = ticket();
    s.work.abandoned.mockResolvedValue([item]);
    s.tx.textFontBuildJob.findUnique.mockResolvedValue({
      id: jobId,
      status: 'PROCESSING',
      claimToken: 'claim',
      attempt: 1,
    });
    await s.service.recoverExpired();
    expect(s.outbox.enqueue).toHaveBeenCalledWith(
      s.tx,
      expect.objectContaining({
        eventKey: `text-font-build:${jobId}:2`,
        payload: { jobId, attempt: 2 },
      }),
    );
    expect(s.work.remove).toHaveBeenCalledWith(item);
    expect(s.outbox.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      s.work.remove.mock.invocationCallOrder[0],
    );
  });
  it('未知作业保留目录，旧 claim 不覆盖现有作业，导入目录独立清理', async () => {
    const s = setup(),
      unknown = ticket(),
      stale = ticket(),
      imported = ticket('import');
    s.work.abandoned.mockResolvedValue([unknown, stale, imported]);
    s.tx.textFontBuildJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: jobId,
        status: 'PROCESSING',
        claimToken: 'new-claim',
        attempt: 2,
      });
    await s.service.recoverExpired();
    expect(s.work.remove.mock.calls).toEqual([[stale], [imported]]);
    expect(s.tx.textFontBuildJob.update).not.toHaveBeenCalled();
    expect(s.outbox.enqueue).not.toHaveBeenCalled();
  });
  it('队列中丢失的作业重新投递，运行中的作业不重复重置', async () => {
    const s = setup();
    s.queued.mockResolvedValue([{ id: jobId, attempt: 1 }]);
    await s.service.recoverExpired();
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    s.queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active') });
    await s.service.recoverExpired();
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    expect(s.tx.textFontBuildJob.updateMany).not.toHaveBeenCalled();
  });
  it.each(['completed', 'failed'])(
    '队列 %s 而数据库仍排队时 CAS 增加 attempt，竞争失败不投递',
    async (state) => {
      const s = setup();
      s.queued.mockResolvedValue([{ id: jobId, attempt: 1 }]);
      s.queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue(state) });
      await s.service.recoverExpired();
      expect(s.tx.textFontBuildJob.updateMany).toHaveBeenCalledWith({
        where: { id: jobId, attempt: 1, status: 'QUEUED' },
        data: { attempt: { increment: 1 } },
      });
      expect(s.outbox.enqueue).toHaveBeenCalledTimes(1);
      s.tx.textFontBuildJob.updateMany.mockResolvedValue({ count: 0 });
      await s.service.recoverExpired();
      expect(s.outbox.enqueue).toHaveBeenCalledTimes(1);
    },
  );
  it('过期租约清除旧 claim 并通过同一事务重新入队', async () => {
    const s = setup();
    s.tx.textFontBuildJob.findMany.mockResolvedValue([{ id: jobId }]);
    await s.service.recoverExpired();
    expect(s.tx.textFontBuildJob.update).toHaveBeenCalledWith({
      where: { id: jobId },
      data: { status: 'QUEUED', attempt: { increment: 1 }, claimToken: null, leaseExpiresAt: null },
    });
    expect(s.outbox.enqueue).toHaveBeenCalledWith(
      s.tx,
      expect.objectContaining({ payload: { jobId, attempt: 2 } }),
    );
  });
  it('恢复轮次不重叠，异常后仍可在下一轮重试', async () => {
    const s = setup();
    let reject!: (reason: Error) => void;
    s.work.abandoned.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const first = s.service.recoverExpired();
    await s.service.recoverExpired();
    expect(s.work.abandoned).toHaveBeenCalledTimes(1);
    reject(new Error('private-database-secret'));
    await first;
    await s.service.recoverExpired();
    expect(s.work.abandoned).toHaveBeenCalledTimes(2);
  });
});

describe('队列失败重试分类', () => {
  const input = (data: unknown) => ({ data }) as Job<{ jobId: string; attempt: number }>;
  it('非法任务在处理前拒绝', async () => {
    const processing = { process: jest.fn() },
      service = new FontProcessor(processing as unknown as FontProcessingService, {} as Queue);
    for (const data of [
      { jobId: 'bad', attempt: 1 },
      { jobId, attempt: 0 },
      { jobId, attempt: 1.5 },
    ])
      await expect(service.process(input(data))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(processing.process).not.toHaveBeenCalled();
  });
  it.each(['invalid-font', 'unsupported-font', 'rights-required', 'resource-limit'] as const)(
    '%s 不重试，临时基础设施失败可重试且不泄露正文',
    async (code) => {
      const processing = { process: jest.fn().mockRejectedValue(new FontProcessingFailure(code)) },
        service = new FontProcessor(processing as unknown as FontProcessingService, {} as Queue);
      await expect(service.process(input({ jobId, attempt: 1 }))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      processing.process.mockRejectedValue(new Error('private-storage-secret'));
      await expect(service.process(input({ jobId, attempt: 1 }))).rejects.toEqual(
        new Error('processing-failed'),
      );
      processing.process.mockResolvedValue(undefined);
      await service.process(input({ jobId, attempt: 1 }));
      expect(processing.process).toHaveBeenLastCalledWith(jobId, 1);
    },
  );
});
