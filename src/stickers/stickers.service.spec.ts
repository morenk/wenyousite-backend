import { Queue } from 'bullmq';
import { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { StickerContentService } from './sticker-content.service';
import { STICKER_COLLECTION_LIMIT } from './sticker.constants';
import { StickerStorageService } from './sticker-storage.service';
import { StickersService } from './stickers.service';

const asset = {
  id: 'asset-1',
  key: 'stickers/aa/asset.webp',
  url: 'https://cdn.example.com/asset.webp',
  thumbnailKey: 'stickers/aa/asset_thumb.webp',
  thumbnailUrl: 'https://cdn.example.com/asset_thumb.webp',
  contentHash: 'a'.repeat(64),
  contentType: 'image/webp',
  size: 100,
  width: 128,
  height: 128,
  animated: false,
  frameCount: 1,
  durationMs: 0,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const favorite = {
  id: 'favorite-1',
  userId: 'user-1',
  assetId: 'asset-1',
  position: 0,
  lastUsedAt: null,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  asset,
};

const pendingImport = {
  id: 'import-1',
  userId: 'user-1',
  sourceMediaId: 'media-1',
  clientRequestId: 'request-1',
  assetId: null,
  status: 'PROCESSING',
  failureCode: null,
  failureMessage: null,
  alreadySaved: false,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
};

describe('StickersService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    stickerCollection: {
      upsert: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    userSticker: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    stickerImport: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    stickerAsset: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    media: { findFirst: jest.fn() },
    directMessage: { findFirst: jest.fn() },
    post: { findUnique: jest.fn(), findFirst: jest.fn() },
    draft: { findFirst: jest.fn() },
  };
  const access = { assertAccessible: jest.fn() };
  const content = { extract: jest.fn(), markdown: jest.fn() };
  const storage = {
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn(),
  };
  const queue = { add: jest.fn() };
  let service: StickersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.stickerCollection.upsert.mockResolvedValue({ userId: 'user-1', version: 1 });
    prisma.stickerCollection.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1', version: 1 });
    prisma.stickerCollection.update.mockResolvedValue({});
    prisma.userSticker.findMany.mockResolvedValue([]);
    prisma.userSticker.findUnique.mockResolvedValue(null);
    prisma.userSticker.findFirst.mockResolvedValue(null);
    prisma.userSticker.count.mockResolvedValue(0);
    prisma.userSticker.create.mockResolvedValue(favorite);
    prisma.userSticker.update.mockResolvedValue(favorite);
    prisma.userSticker.updateMany.mockResolvedValue({ count: 0 });
    prisma.userSticker.delete.mockResolvedValue(favorite);
    prisma.stickerImport.findMany.mockResolvedValue([]);
    prisma.stickerImport.findUnique.mockResolvedValue(null);
    prisma.stickerImport.findFirst.mockResolvedValue(null);
    prisma.stickerImport.count.mockResolvedValue(0);
    prisma.stickerImport.create.mockResolvedValue(pendingImport);
    prisma.stickerImport.update.mockResolvedValue({});
    prisma.stickerImport.updateMany.mockResolvedValue({ count: 1 });
    prisma.stickerImport.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stickerAsset.findMany.mockResolvedValue([]);
    prisma.stickerAsset.deleteMany.mockResolvedValue({ count: 1 });
    access.assertAccessible.mockResolvedValue(undefined);
    content.extract.mockReturnValue([]);
    content.markdown.mockReturnValue('![表情](https://cdn.example.com/asset.webp)');
    storage.download.mockResolvedValue(Buffer.from('source'));
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    storage.publicUrl.mockImplementation((key: string) => `https://cdn.example.com/${key}`);
    queue.add.mockResolvedValue({});
    service = new StickersService(
      prisma as unknown as PrismaService,
      access as unknown as ThreadAccessService,
      content as unknown as StickerContentService,
      storage as unknown as StickerStorageService,
      queue as unknown as Queue,
    );
  });

  it('收藏夹同时返回排序收藏、最近使用、处理中导入和版本', async () => {
    prisma.userSticker.findMany
      .mockResolvedValueOnce([favorite])
      .mockResolvedValueOnce([{ ...favorite, lastUsedAt: new Date('2026-08-03T00:00:00.000Z') }]);
    prisma.stickerImport.findMany.mockResolvedValue([pendingImport]);

    await expect(service.getCollection('user-1')).resolves.toEqual({
      version: 1,
      limit: STICKER_COLLECTION_LIMIT,
      items: [expect.objectContaining({ id: 'favorite-1', markdown: expect.any(String) })],
      recent: [expect.objectContaining({ id: 'favorite-1' })],
      pendingImports: [expect.objectContaining({ id: 'import-1', status: 'PROCESSING' })],
    });
    expect(prisma.userSticker.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: 'user-1', lastUsedAt: { not: null } },
      }),
    );
  });

  it('只能从本人且处理完成的媒体导入', async () => {
    prisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.importMedia('user-1', {
        mediaId: 'media-1',
        clientRequestId: 'request-1',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STICKER });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('媒体导入在收藏夹锁内校验容量并以导入 ID 幂等入队', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'media-1' });
    prisma.stickerImport.findFirst.mockResolvedValue(pendingImport);

    await expect(
      service.importMedia('user-1', {
        mediaId: 'media-1',
        clientRequestId: 'request-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'import-1',
        status: 'PROCESSING',
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.userSticker.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { importId: 'import-1' },
      expect.objectContaining({ jobId: 'import-1', attempts: 2 }),
    );
  });

  it('同一导入请求直接返回原记录且不重复入队', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'media-1' });
    prisma.stickerImport.findUnique.mockResolvedValue(pendingImport);
    prisma.stickerImport.findFirst.mockResolvedValue(pendingImport);

    await service.importMedia('user-1', {
      mediaId: 'media-1',
      clientRequestId: 'request-1',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('队列不可用时把导入标记为失败', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'media-1' });
    prisma.stickerImport.findFirst.mockResolvedValue({
      ...pendingImport,
      status: 'FAILED',
      failureCode: 'PROCESSING_FAILED',
      failureMessage: 'queue down',
    });
    queue.add.mockRejectedValue(new Error('queue down'));
    const loggerWarn = jest
      .spyOn(
        (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await service.importMedia('user-1', {
      mediaId: 'media-1',
      clientRequestId: 'request-1',
    });

    expect(prisma.stickerImport.updateMany).toHaveBeenCalledWith({
      where: { id: 'import-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureCode: 'PROCESSING_FAILED',
        failureMessage: 'queue down',
      }),
    });
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('私聊消息不存在图片或表情时返回 404', async () => {
    prisma.directMessage.findFirst.mockResolvedValue({ mediaId: null, stickerAssetId: null });

    await expect(
      service.importDirectMessage('user-1', {
        directMessageId: 'message-1',
        clientRequestId: 'request-1',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STICKER_NOT_FOUND });
  });

  it('私聊已有表情资产时直接收藏且不进入处理队列', async () => {
    prisma.directMessage.findFirst.mockResolvedValue({ mediaId: null, stickerAssetId: 'asset-1' });
    prisma.stickerAsset.findUnique.mockResolvedValue(asset);
    prisma.userSticker.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(favorite);
    prisma.stickerImport.create.mockResolvedValue({
      ...pendingImport,
      assetId: 'asset-1',
      status: 'COMPLETED',
    });
    prisma.stickerImport.findFirst.mockResolvedValue({
      ...pendingImport,
      assetId: 'asset-1',
      status: 'COMPLETED',
    });

    await expect(
      service.importDirectMessage('user-1', {
        directMessageId: 'message-1',
        clientRequestId: 'request-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        favorite: expect.objectContaining({ id: 'favorite-1' }),
      }),
    );
    expect(prisma.userSticker.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', assetId: 'asset-1', position: 0 },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('帖子图片导入先校验主题可访问性及正文中的精确图片令牌', async () => {
    prisma.post.findUnique.mockResolvedValue({ threadId: 'thread-1', content: '正文' });
    content.extract.mockReturnValue([]);

    await expect(
      service.importPostImage('user-1', {
        postId: 'post-1',
        imageUrl: 'https://cdn.example.com/missing.webp',
        clientRequestId: 'request-1',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STICKER_NOT_FOUND });
    expect(access.assertAccessible).toHaveBeenCalledWith('thread-1', 'user-1');
    expect(prisma.media.findFirst).not.toHaveBeenCalled();
  });

  it('帖子表情令牌必须与真实资产 URL 匹配', async () => {
    prisma.post.findUnique.mockResolvedValue({ threadId: 'thread-1', content: '正文' });
    content.extract.mockReturnValue([
      {
        url: asset.url,
        stickerAssetId: 'asset-1',
      },
    ]);
    prisma.stickerAsset.findFirst.mockResolvedValue(null);

    await expect(
      service.importPostImage('user-1', {
        postId: 'post-1',
        imageUrl: asset.url,
        clientRequestId: 'request-1',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STICKER_NOT_FOUND });
    expect(prisma.stickerAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-1', url: asset.url },
      select: { id: true },
    });
  });

  it('排序拒绝重复 ID 和过期版本', async () => {
    await expect(
      service.reorder('user-1', {
        version: 1,
        favoriteIds: ['favorite-1', 'favorite-1'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STICKER });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    prisma.stickerCollection.findUniqueOrThrow.mockResolvedValue({ version: 2 });
    await expect(
      service.reorder('user-1', {
        version: 1,
        favoriteIds: ['favorite-1'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STICKER_COLLECTION_VERSION_CONFLICT });
  });

  it('排序必须包含完整收藏集合并原子递增版本', async () => {
    prisma.userSticker.findMany
      .mockResolvedValueOnce([{ id: 'favorite-1' }, { id: 'favorite-2' }])
      .mockResolvedValueOnce([favorite, { ...favorite, id: 'favorite-2', position: 1 }])
      .mockResolvedValueOnce([]);
    prisma.stickerCollection.upsert.mockResolvedValue({ version: 2 });

    const result = await service.reorder('user-1', {
      version: 1,
      favoriteIds: ['favorite-2', 'favorite-1'],
    });

    expect(prisma.userSticker.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'favorite-2' },
      data: { position: 0 },
    });
    expect(prisma.userSticker.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'favorite-1' },
      data: { position: 1 },
    });
    expect(prisma.stickerCollection.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { version: { increment: 1 } },
    });
    expect(result.version).toBe(2);
  });

  it('删除收藏会收拢后续位置并递增版本', async () => {
    prisma.userSticker.findFirst.mockResolvedValue({ ...favorite, position: 2 });

    await service.remove('user-1', 'favorite-1');

    expect(prisma.userSticker.delete).toHaveBeenCalledWith({ where: { id: 'favorite-1' } });
    expect(prisma.userSticker.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', position: { gt: 2 } },
      data: { position: { decrement: 1 } },
    });
    expect(prisma.stickerCollection.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { version: { increment: 1 } },
    });
  });

  it('发送表情前要求资产属于当前收藏并记录最近使用时间', async () => {
    prisma.userSticker.findUnique.mockResolvedValue(favorite);

    await expect(service.assertFavorite('user-1', 'asset-1')).resolves.toBe(favorite);
    await service.recordUsage('user-1', 'asset-1');

    expect(prisma.userSticker.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', assetId: 'asset-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('处理导入时复用内容哈希资产并完成收藏', async () => {
    const source = { status: 'COMPLETED', size: 100, key: 'uploads/source.webp' };
    prisma.stickerImport.findUnique
      .mockResolvedValueOnce({ ...pendingImport, sourceMedia: source })
      .mockResolvedValueOnce(pendingImport);
    prisma.stickerAsset.findUnique.mockResolvedValue(asset);
    const internals = service as unknown as {
      normalize(input: Buffer): Promise<{
        main: Buffer;
        thumbnail: Buffer;
        width: number;
        height: number;
        animated: boolean;
        frameCount: number;
        durationMs: number;
      }>;
    };
    jest.spyOn(internals, 'normalize').mockResolvedValue({
      main: Buffer.from('normalized'),
      thumbnail: Buffer.from('thumbnail'),
      width: 128,
      height: 128,
      animated: false,
      frameCount: 1,
      durationMs: 0,
    });

    await service.processImport('import-1');

    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.userSticker.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', assetId: 'asset-1', position: 0 },
    });
    expect(prisma.stickerImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: {
        status: 'COMPLETED',
        assetId: 'asset-1',
        alreadySaved: false,
      },
    });
  });

  it('忽略不存在、非处理中或缺少来源媒体的处理任务', async () => {
    prisma.stickerImport.findUnique.mockResolvedValue({
      ...pendingImport,
      status: 'COMPLETED',
      sourceMedia: null,
    });

    await expect(service.processImport('import-1')).resolves.toBeUndefined();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('失败原因最多持久化 500 字符', async () => {
    const loggerWarn = jest
      .spyOn(
        (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await service.markImportFailed('import-1', new Error('错'.repeat(600)));

    const call = prisma.stickerImport.updateMany.mock.calls[0][0];
    expect(call.data.failureMessage).toHaveLength(500);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('定时清理只删除过期终态导入记录，保留可能被 Markdown 引用的资产', async () => {
    await service.cleanupOrphanAssets();

    expect(prisma.stickerImport.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['COMPLETED', 'FAILED'] },
        updatedAt: { lt: expect.any(Date) },
      },
    });
    expect(prisma.stickerAsset.findMany).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(prisma.stickerAsset.deleteMany).not.toHaveBeenCalled();
  });
});
