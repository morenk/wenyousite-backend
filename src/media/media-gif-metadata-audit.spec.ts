import { PrismaClient } from '@prisma/client';
import { gif } from '../common/image-inspection.fixtures';
import { ObjectStorageService } from '../storage/object-storage.service';
import { auditGifMetadata } from './media-gif-metadata-audit';

describe('GIF 元数据只读审计', () => {
  const prisma = { media: { findMany: jest.fn() } };
  const storage = { download: jest.fn() };
  const emit = jest.fn();
  const run = (options = {}) =>
    auditGifMetadata(
      prisma as unknown as PrismaClient,
      storage as unknown as ObjectStorageService,
      emit,
      options,
    );
  beforeEach(() => jest.resetAllMocks());

  it('真实 GIF 生成保留旧值的修复候选，并使用删除过滤和单次下载上限', async () => {
    prisma.media.findMany
      .mockResolvedValueOnce([
        { id: 'm-1', key: 'private-key', size: 100, width: 80, height: 3000, animated: false },
      ])
      .mockResolvedValue([]);
    storage.download.mockResolvedValue(await gif(80, 100, 30));
    expect(await run()).toEqual({
      kind: 'summary',
      mode: 'read-only',
      scanned: 1,
      candidates: 1,
      skipped: 0,
      nextAfter: 'm-1',
    });
    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contentType: 'image/gif', status: 'COMPLETED', deletionClaimedAt: null },
      }),
    );
    expect(storage.download).toHaveBeenCalledWith('private-key', undefined, 10 * 1024 * 1024);
    expect(emit).toHaveBeenCalledWith({
      kind: 'candidate',
      mediaId: 'm-1',
      before: { width: 80, height: 3000, animated: false },
      after: { width: 80, height: 100, animated: true },
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private-key');
  });

  it('已一致记录不产生候选，游标和数量上限可分批重跑', async () => {
    prisma.media.findMany.mockResolvedValue([
      { id: 'm-2', key: 'private-key', size: 100, width: 8, height: 8, animated: true },
    ]);
    storage.download.mockResolvedValue(await gif(8, 8, 2));
    expect(await run({ limit: 1, after: 'm-1' })).toEqual(
      expect.objectContaining({ scanned: 1, candidates: 0, nextAfter: 'm-2' }),
    );
    expect(prisma.media.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 'm-1' } }), take: 1 }),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('超限、对象缺失和坏图跳过且不泄露异常内容', async () => {
    prisma.media.findMany
      .mockResolvedValueOnce([
        { id: 'large', key: 'large-key', size: 10 * 1024 * 1024 + 1 },
        { id: 'missing', key: 'missing-key', size: null },
        { id: 'invalid', key: 'invalid-key', size: 12 },
      ])
      .mockResolvedValue([]);
    storage.download
      .mockRejectedValueOnce(new Error('private-object-url'))
      .mockResolvedValueOnce(Buffer.from('not an image'));
    expect(await run()).toEqual(expect.objectContaining({ scanned: 3, skipped: 3, candidates: 0 }));
    expect(storage.download).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(
      /private-object|large-key|missing-key|invalid-key/,
    );
  });
});
