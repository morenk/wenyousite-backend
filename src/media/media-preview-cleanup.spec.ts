
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { animationPreviewKey } from './media-animation-preview-policy';
import { cleanupMediaPreviewAttempts } from './media-preview-cleanup';

describe('预览补偿账目与迟到写入', () => {
  const key = animationPreviewKey('media/master.gif', 'old', 480);
  const row = { id: 'old', status: 'PENDING', media: { key: 'media/master.gif' }, keys: [key], nextCleanupAt: new Date(0), cleanupPasses: 0 };
  const ledger = { findMany: jest.fn(), updateMany: jest.fn() };
  const storage = { remove: jest.fn() };
  const prisma = { mediaPreviewAttempt: ledger } as unknown as PrismaService;
  beforeEach(() => { jest.useFakeTimers({ now: 100_000 }); jest.clearAllMocks(); ledger.findMany.mockResolvedValue([row]); ledger.updateMany.mockResolvedValue({ count: 1 }); storage.remove.mockResolvedValue(undefined); });
  afterEach(() => jest.useRealTimers());

  it('旧快照已经发布时 CAS 不得删除资源', async () => {
    ledger.updateMany.mockResolvedValue({ count: 0 });
    expect(await cleanupMediaPreviewAttempts(prisma, storage as unknown as ObjectStorageService)).toBe(0);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(ledger.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old', status: 'PENDING', nextCleanupAt: new Date(0), expiresAt: { lte: new Date() } } }));
  });
  it('删除 404 后仍保留墓碑，下次复查可删除迟到 PUT；不碰新尝试', async () => {
    const objects = new Set<string>([animationPreviewKey('media/master.gif', 'new', 480)]);
    storage.remove.mockImplementation(async (value) => { objects.delete(value); });
    expect(await cleanupMediaPreviewAttempts(prisma, storage as unknown as ObjectStorageService)).toBe(1);
    const scheduled = ledger.updateMany.mock.calls[1][0].data.nextCleanupAt;
    expect(scheduled.getTime() - Date.now()).toBe(86_400_000);
    objects.add(key);
    ledger.findMany.mockResolvedValue([{ ...row, status: 'CLEANING', nextCleanupAt: scheduled, cleanupPasses: 1 }]);
    jest.setSystemTime(scheduled);
    await cleanupMediaPreviewAttempts(prisma, storage as unknown as ObjectStorageService);
    expect(objects.has(key)).toBe(false);
    expect(objects.size).toBe(1);
    expect(ledger.updateMany.mock.calls[3][0].data.nextCleanupAt.getTime() - Date.now()).toBe(172_800_000);
  });
  it('存储失败保留十分钟重试，超时取消删除', async () => {
    storage.remove.mockImplementation(() => new Promise(() => undefined));
    const promise = cleanupMediaPreviewAttempts(prisma, storage as unknown as ObjectStorageService);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await promise).toBe(0);
    expect(storage.remove.mock.calls[0][2].aborted).toBe(true);
    expect(ledger.updateMany.mock.calls[1][0].data).toEqual({ nextCleanupAt: new Date(Date.now() + 600_000) });
  });
  it('限制批次并拒绝不属于尝试的 key', async () => {
    ledger.findMany.mockResolvedValue([{ ...row, keys: ['unrelated-secret'] }]);
    await cleanupMediaPreviewAttempts(prisma, storage as unknown as ObjectStorageService, 999);
    expect(ledger.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 100, orderBy: { nextCleanupAt: 'asc' } }));
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
