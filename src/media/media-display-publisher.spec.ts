jest.mock('./media-animation-display', () => ({ generateAnimationDisplay: jest.fn() }));
import { Media, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { generateAnimationDisplay } from './media-animation-display';
import { ensureAnimationDisplay, processHistoricalDisplay } from './media-display-publisher';

const encode = jest.mocked(generateAnimationDisplay);
const media = { id: 'm', key: 'media/a.gif', displayAsset: null, displayAttempts: 0 } as Media;
const encoded = { body: Buffer.alloc(100), width: 20, height: 30, frameCount: 3, durationMs: 600, loopCount: 2 };

describe('必需完整展示发布与历史补处理', () => {
  const db = { mediaPreviewAttempt: { create: jest.fn(), updateMany: jest.fn() },
    media: { updateMany: jest.fn(), findFirst: jest.fn() }, $transaction: jest.fn() };
  const objects = { upload: jest.fn(), download: jest.fn(), publicUrl: (key: string) => 'https://cdn.test/' + key };
  const prisma = db as unknown as PrismaService;
  const storage = objects as unknown as ObjectStorageService;
  beforeEach(() => {
    jest.clearAllMocks(); encode.mockResolvedValue(encoded);
    db.mediaPreviewAttempt.create.mockResolvedValue({}); db.mediaPreviewAttempt.updateMany.mockResolvedValue({ count: 1 });
    db.media.updateMany.mockResolvedValue({ count: 1 }); db.media.findFirst.mockResolvedValue(null);
    db.$transaction.mockImplementation((fn) => fn(db)); objects.upload.mockResolvedValue(undefined); objects.download.mockResolvedValue(Buffer.alloc(1));
  });

  it('先记精确独立key，再PUT，最后同事务发布；完整产物比来源大仍发布', async () => {
    const first = await ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1));
    const second = await ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1));
    expect(first).toMatchObject({ contentType: 'image/webp', bytes: 100, frameCount: 3, durationMs: 600, loopCount: 2 });
    expect(first.url).not.toBe(second.url);
    expect(db.mediaPreviewAttempt.create.mock.invocationCallOrder[0]).toBeLessThan(objects.upload.mock.invocationCallOrder[0]);
    expect(objects.upload.mock.invocationCallOrder[0]).toBeLessThan(db.$transaction.mock.invocationCallOrder[1]);
    expect(db.media.updateMany.mock.calls[1][0]).toMatchObject({ where: { key: media.key, deletionClaimedAt: null, displayAsset: { equals: Prisma.DbNull } },
      data: { displayStatus: 'READY', displayAsset: first } });
    expect(db.media.updateMany.mock.calls[1][0].data).not.toHaveProperty('url');
    expect(db.media.updateMany.mock.calls[1][0].data).not.toHaveProperty('status');
  });
  it('编码或存储失败不能成功，失败PUT保留补偿记录而不发布', async () => {
    encode.mockRejectedValueOnce(new Error('encoding-failure'));
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('encoding-failure');
    expect(objects.upload).not.toHaveBeenCalled();
    objects.upload.mockRejectedValueOnce(new Error('put-failure'));
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('put-failure');
    expect(db.mediaPreviewAttempt.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('发布CAS失败恢复尝试为可清理，禁止覆盖其它结果', async () => {
    db.media.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('DISPLAY_PUBLICATION_CONFLICT');
    expect(db.mediaPreviewAttempt.updateMany).toHaveBeenLastCalledWith({ where: { id: expect.any(String), status: 'PUBLISHED' }, data: { status: 'PENDING' } });
  });
  it('清理先领取或事务失败不能宣布READY', async () => {
    db.mediaPreviewAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('DISPLAY_PUBLICATION_CONFLICT');
    expect(db.media.updateMany).toHaveBeenCalledTimes(1);
    db.$transaction.mockRejectedValueOnce(new Error('rollback'));
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('rollback');
  });
  it('上传超时中断请求且不发布，迟到完成仍只能补偿', async () => {
    jest.useFakeTimers();
    try {
      let finish!: () => void; objects.upload.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
      const promise = ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1));
      const failure = expect(promise).rejects.toThrow('DISPLAY_UPLOAD_TIMEOUT');
      await jest.advanceTimersByTimeAsync(30_000); await failure;
      expect(objects.upload.mock.calls[0][2].abortSignal.aborted).toBe(true);
      finish(); await Promise.resolve(); expect(db.$transaction).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  it('删除先领取时登记事务失败且没有 PUT 或新账本', async () => {
    db.media.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ensureAnimationDisplay(prisma, storage, media, Buffer.alloc(1))).rejects.toThrow('DISPLAY_MEDIA_UNAVAILABLE');
    expect(db.mediaPreviewAttempt.create).not.toHaveBeenCalled(); expect(objects.upload).not.toHaveBeenCalled();
  });
  it('历史错误保持COMPLETED和来源身份，记录独立失败并累计有限尝试', async () => {
    db.media.findFirst.mockResolvedValueOnce(media); encode.mockRejectedValueOnce(new Error('broken'));
    await expect(processHistoricalDisplay(prisma, storage, media.id)).rejects.toThrow('broken');
    expect(db.media.findFirst.mock.calls[0][0].where).toMatchObject({ status: 'COMPLETED', displayAttempts: { lt: 3 } });
    for (const [query] of db.media.updateMany.mock.calls) {
      expect(query.data).not.toHaveProperty('status'); expect(query.data).not.toHaveProperty('url');
    }
    expect(db.media.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ displayStatus: 'FAILED' }) }));
  });
  it('历史租约竞争失败不启动下载或编码', async () => {
    db.media.findFirst.mockResolvedValueOnce(media); db.media.updateMany.mockResolvedValueOnce({ count: 0 });
    await processHistoricalDisplay(prisma, storage, media.id);
    expect(objects.download).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled();
  });
});
