
jest.mock('./media-animation-preview', () => ({ generateAnimationPreviews: jest.fn() }));
import { MediaPurpose, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { generateAnimationPreviews } from './media-animation-preview';
import { completeMediaWithPreviews, stageOptionalPreviews } from './media-animation-preview-publisher';

const encode = jest.mocked(generateAnimationPreviews);
const media = { id: 'm', key: 'media/master.gif', purpose: MediaPurpose.RICH_CONTENT, processingStartedAt: null };
const variant = { edge: 480 as const, width: 480, height: 270, body: Buffer.alloc(10) };
describe('可选预览发布预算与事务', () => {
  const db = { mediaPreviewAttempt: { create: jest.fn(), updateMany: jest.fn() }, media: { updateMany: jest.fn() }, $transaction: jest.fn() };
  const storage = { upload: jest.fn(), publicUrl: (key: string) => 'https://media.test/' + key };
  const prisma = db as unknown as PrismaService;
  const objects = storage as unknown as ObjectStorageService;
  beforeEach(() => {
    jest.useFakeTimers({ now: 100_000 });
    jest.clearAllMocks();
    encode.mockResolvedValue([variant]);
    db.mediaPreviewAttempt.create.mockResolvedValue({});
    db.mediaPreviewAttempt.updateMany.mockResolvedValue({ count: 1 });
    db.media.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation((fn) => fn(db));
    storage.upload.mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());

  it('排队超过十九秒跳过附加工作', async () => {
    expect(await stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), 80_000)).toEqual({ attemptId: null, variants: null });
    expect(encode).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('慢编码和慢数据库均受同一八秒预算，迟到建账不能启动 PUT', async () => {
    let finish!: (value: unknown) => void;
    db.mediaPreviewAttempt.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const promise = stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), Date.now());
    await jest.advanceTimersByTimeAsync(8_000);
    expect(await promise).toEqual({ attemptId: null, variants: null });
    finish({});
    await Promise.resolve();
    expect(storage.upload).not.toHaveBeenCalled();
    encode.mockImplementation(() => new Promise(() => undefined));
    const slow = stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), Date.now());
    await jest.advanceTimersByTimeAsync(8_000);
    expect(await slow).toEqual({ attemptId: null, variants: null });
  });
  it('两档上传共享剩余预算且 abort；保留先于 PUT 的精确补偿账目', async () => {
    encode.mockResolvedValue([variant, { ...variant, edge: 800, width: 800, height: 450 }]);
    storage.upload.mockImplementation(() => new Promise(() => undefined));
    const promise = stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), 85_000);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await promise).toEqual({ attemptId: null, variants: null });
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.upload.mock.calls[0][2].abortSignal.aborted).toBe(true);
    const record = db.mediaPreviewAttempt.create.mock.calls[0][0].data;
    expect(record.keys).toEqual(storage.upload.mock.calls.map(([key]) => key));
    expect(db.mediaPreviewAttempt.create.mock.invocationCallOrder[0]).toBeLessThan(storage.upload.mock.invocationCallOrder[0]);
  });
  it('预览存储失败仍可完成基础媒体，不替换原 URL', async () => {
    storage.upload.mockRejectedValue(new Error('optional storage failure'));
    const staged = await stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), Date.now());
    await completeMediaWithPreviews(prisma, media.id, { status: 'COMPLETED', url: 'original.gif' }, staged);
    expect(db.media.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'COMPLETED', url: 'original.gif', previewVariants: Prisma.DbNull },
    }));
    expect(db.mediaPreviewAttempt.create).toHaveBeenCalledTimes(1);
  });
  it('重试使用独立 key，发布资源 URL 在响应中保持稳定', async () => {
    const first = await stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), Date.now());
    const second = await stageOptionalPreviews(prisma, objects, media, Buffer.alloc(100), Date.now());
    expect(first.attemptId).not.toBe(second.attemptId);
    expect(first.variants![0].url).not.toBe(second.variants![0].url);
    await completeMediaWithPreviews(prisma, media.id, { status: 'COMPLETED' }, second);
    expect(db.media.updateMany.mock.calls[0][0].data.previewVariants).toEqual(second.variants);
  });
  it('清理已抢占时发布 CAS 失败，只完成基础媒体', async () => {
    db.mediaPreviewAttempt.updateMany.mockResolvedValue({ count: 0 });
    await completeMediaWithPreviews(prisma, 'm', { status: 'COMPLETED' }, { attemptId: 'a', variants: [{ url: 'preview', width: 1, height: 1, bytes: 1 }] });
    expect(db.mediaPreviewAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING', expiresAt: { gt: new Date() } }) }));
    expect(db.media.updateMany.mock.calls[0][0].data.previewVariants).toBe(Prisma.DbNull);
  });
  it('可选发布事务失败回退基础完成，事务等待与执行受剩余预算约束', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('transaction timeout'));
    await completeMediaWithPreviews(prisma, 'm', { status: 'COMPLETED' }, { attemptId: 'a', variants: [], deadline: Date.now() + 700 });
    expect(db.$transaction.mock.calls[0][1]).toEqual({ maxWait: 250, timeout: 450 });
    expect(db.media.updateMany.mock.calls[0][0].data.previewVariants).toBe(Prisma.DbNull);
  });

  it('媒体完成 CAS 失败时撤回发布状态，让独立尝试可回收', async () => {
    db.media.updateMany.mockResolvedValue({ count: 0 });
    await completeMediaWithPreviews(prisma, 'm', { status: 'COMPLETED' }, { attemptId: 'a', variants: [] });
    expect(db.mediaPreviewAttempt.updateMany).toHaveBeenLastCalledWith({ where: { id: 'a', status: 'PUBLISHED' }, data: { status: 'PENDING' } });
  });
});
