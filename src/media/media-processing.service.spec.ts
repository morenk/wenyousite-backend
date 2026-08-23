import { MediaPurpose } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaProcessingService } from './media-processing.service';

const prisma = {
  media: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

const storage = {
  download: jest.fn(),
  upload: jest.fn(),
  remove: jest.fn(),
};

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: 'media-1',
    userId: 'user-1',
    url: 'https://objects.example/media/master.webp',
    key: 'media/master.webp',
    stagingKey: 'staging/source.jpg',
    purpose: MediaPurpose.MOMENT,
    contentType: 'image/jpeg',
    size: 100,
    width: null,
    height: null,
    animated: false,
    status: 'PROCESSING',
    processingStartedAt: new Date(),
    createdAt: new Date(),
    orphanedAt: null,
    ...overrides,
  };
}

describe('MediaProcessingService', () => {
  let service: MediaProcessingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.updateMany.mockResolvedValue({ count: 1 });
    prisma.media.findMany.mockResolvedValue([]);
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    service = new MediaProcessingService(
      prisma as unknown as PrismaService,
      storage as unknown as ObjectStorageService,
    );
    jest.spyOn(
      (service as unknown as { logger: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } })
        .logger,
      'log',
    ).mockImplementation(() => undefined);
    jest.spyOn(
      (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('静态图片应修正方向、压到 2560 内、移除元数据并按用途生成派生图', async () => {
    const source = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#cc8844' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92 })
      .toBuffer();
    prisma.media.findUnique.mockResolvedValue(media({ size: source.length }));
    storage.download.mockResolvedValue(source);

    await service.processImage('media-1', { queueWaitMs: 12 });

    expect(storage.upload).toHaveBeenCalledTimes(4);
    const masterCall = storage.upload.mock.calls.find(([key]) => key === 'media/master.webp');
    expect(masterCall).toBeDefined();
    const master = masterCall![1] as Buffer;
    const metadata = await sharp(master).metadata();
    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width!, metadata.height!)).toBe(2560);
    expect(metadata.orientation).toBeUndefined();
    expect(storage.remove).toHaveBeenCalledWith('staging/source.jpg');
    expect(prisma.media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1', status: 'PROCESSING' },
        data: expect.objectContaining({
          contentType: 'image/webp',
          animated: false,
          status: 'COMPLETED',
        }),
      }),
    );
  });

  it('头像只保存归一化母版，不生成无用派生图', async () => {
    const source = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#336699cc' },
    })
      .png()
      .toBuffer();
    prisma.media.findUnique.mockResolvedValue(
      media({ purpose: MediaPurpose.AVATAR, contentType: 'image/png', size: source.length }),
    );
    storage.download.mockResolvedValue(source);

    await service.processImage('media-1');

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledWith(
      'media/master.webp',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/webp' }),
    );
  });

  it('GIF 应逐字节保留母版并只生成静态缩略图', async () => {
    const source = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    prisma.media.findUnique.mockResolvedValue(
      media({
        key: 'media/master.gif',
        purpose: MediaPurpose.DIRECT_MESSAGE,
        contentType: 'image/gif',
        size: source.length,
      }),
    );
    storage.download.mockResolvedValue(source);

    await service.processImage('media-1');

    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenCalledWith(
      'media/master.gif',
      source,
      expect.objectContaining({ contentType: 'image/gif' }),
    );
    expect(storage.upload).toHaveBeenCalledWith(
      'media/master_thumb.webp',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/webp' }),
    );
    expect(prisma.media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ animated: true }) }),
    );
  });

  it('真实格式与签发 MIME 不一致时应失败且不写正式对象', async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    prisma.media.findUnique.mockResolvedValue(media({ contentType: 'image/jpeg' }));
    storage.download.mockResolvedValue(source);

    await expect(service.processImage('media-1')).rejects.toThrow('IMAGE_TYPE_MISMATCH');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('正式状态提交后临时对象删除失败应保留 stagingKey 等待补偿', async () => {
    const source = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    prisma.media.findUnique.mockResolvedValue(media());
    storage.download.mockResolvedValue(source);
    storage.remove.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.processImage('media-1')).resolves.toBeUndefined();

    expect(prisma.media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(prisma.media.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { stagingKey: null } }),
    );
  });

  it('最终失败应转为 FAILED 并清除临时对象', async () => {
    prisma.media.findUnique.mockResolvedValue({ stagingKey: 'staging/source.jpg' });

    await service.markFailed('media-1');

    expect(prisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'media-1', status: 'PROCESSING' },
      data: { status: 'FAILED', processingStartedAt: null },
    });
    expect(storage.remove).toHaveBeenCalledWith('staging/source.jpg');
  });
});
