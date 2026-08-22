import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StickerProcessingRecoveryService } from './sticker-processing-recovery.service';
import { StickersService } from './stickers.service';

describe('StickerProcessingRecoveryService', () => {
  const prisma = {
    stickerImport: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const stickers = {
    enqueueImport: jest.fn(),
    markImportFailed: jest.fn(),
  };
  const queue = { getJob: jest.fn() };
  let service: StickerProcessingRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.stickerImport.findMany.mockResolvedValue([{ id: 'import-1' }]);
    prisma.stickerImport.updateMany.mockResolvedValue({ count: 1 });
    stickers.enqueueImport.mockResolvedValue(undefined);
    stickers.markImportFailed.mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue(undefined);
    service = new StickerProcessingRecoveryService(
      prisma as unknown as PrismaService,
      stickers as unknown as StickersService,
      queue as unknown as Queue,
    );
  });

  it('为 Redis 中缺失的超时导入任务重新入队', async () => {
    await service.reconcile();

    expect(prisma.stickerImport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PROCESSING' }),
        take: 100,
      }),
    );
    expect(stickers.enqueueImport).toHaveBeenCalledWith('import-1');
    expect(prisma.stickerImport.updateMany).toHaveBeenCalledWith({
      where: { id: 'import-1', status: 'PROCESSING' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('保留仍在执行的导入任务', async () => {
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active') });

    await service.reconcile();

    expect(stickers.enqueueImport).not.toHaveBeenCalled();
    expect(stickers.markImportFailed).not.toHaveBeenCalled();
  });

  it('队列终态失败时持久化失败状态', async () => {
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('failed') });

    await service.reconcile();

    expect(stickers.markImportFailed).toHaveBeenCalledWith('import-1', expect.any(Error));
    expect(stickers.enqueueImport).not.toHaveBeenCalled();
  });
});
