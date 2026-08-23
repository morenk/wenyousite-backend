import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MediaProcessingRecoveryService } from './media-processing-recovery.service';
import { MediaService } from './media.service';

describe('MediaProcessingRecoveryService', () => {
  const prisma = {
    media: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const media = {
    enqueueProcessing: jest.fn(),
    markFailed: jest.fn(),
  };
  const queue = { getJob: jest.fn() };
  let service: MediaProcessingRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.findMany.mockResolvedValue([{ id: 'media-1', key: 'uploads/source.webp' }]);
    prisma.media.updateMany.mockResolvedValue({ count: 1 });
    media.enqueueProcessing.mockResolvedValue(undefined);
    media.markFailed.mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue(undefined);
    service = new MediaProcessingRecoveryService(
      prisma as unknown as PrismaService,
      media as unknown as MediaService,
      queue as unknown as Queue,
    );
  });

  it('为 Redis 中缺失的超时任务重新入队并刷新租约时间', async () => {
    await service.reconcile();

    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PROCESSING' }),
        take: 100,
      }),
    );
    expect(media.enqueueProcessing).toHaveBeenCalledWith('media-1');
    expect(prisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'media-1', status: 'PROCESSING' },
      data: { processingStartedAt: expect.any(Date) },
    });
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized'])(
    '保留仍处于 %s 的任务',
    async (state) => {
      queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue(state) });

      await service.reconcile();

      expect(media.enqueueProcessing).not.toHaveBeenCalled();
      expect(media.markFailed).not.toHaveBeenCalled();
    },
  );

  it('队列终态失败时同步数据库 FAILED', async () => {
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('failed') });

    await service.reconcile();

    expect(media.markFailed).toHaveBeenCalledWith('media-1');
    expect(media.enqueueProcessing).not.toHaveBeenCalled();
  });

  it('队列显示完成但数据库仍处理中时移除旧任务并重建', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      remove,
    });

    await service.reconcile();

    expect(remove).toHaveBeenCalled();
    expect(media.enqueueProcessing).toHaveBeenCalledWith('media-1');
  });
});
