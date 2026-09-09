import { MediaPurpose } from '@prisma/client';
import sharp from 'sharp';
import { apng, gif } from '../common/image-inspection.fixtures';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaProcessingService } from './media-processing.service';

const prisma = { media: { findUnique: jest.fn(), updateMany: jest.fn() } };
const storage = { download: jest.fn(), upload: jest.fn(), remove: jest.fn() };

describe.each(['staging', 'LEGACY'] as const)('GIF %s 处理', (path) => {
  let service: MediaProcessingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.findUnique.mockResolvedValue({
      id: 'gif-1',
      key: 'media/master.gif',
      stagingKey: path === 'staging' ? 'staging/source.gif' : null,
      purpose: path === 'staging' ? MediaPurpose.RICH_CONTENT : MediaPurpose.LEGACY,
      contentType: 'image/gif',
      status: 'PROCESSING',
    });
    prisma.media.updateMany.mockResolvedValue({ count: 1 });
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    service = new MediaProcessingService(
      prisma as unknown as PrismaService,
      storage as unknown as ObjectStorageService,
    );
  });

  it.each([
    [80, 100, 30, 100],
    [80, 100, 2, 100],
    [1000, 50, 50, 100],
    [1000, 1000, 100, 100],
    [2560, 1, 1, 100],
    [1, 2560, 1, 100],
    [1, 1, 300, 200],
  ])(
    '合法 %i×%i、%i 帧、帧间隔 %i ms 应保留单帧尺寸和母版',
    async (width, height, frames, delay) => {
      const source = await gif(width, height, frames, delay);
      const metadata = await sharp(source, {
        animated: true,
        limitInputPixels: 100_000_000,
      }).metadata();
      expect(metadata).toEqual(
        expect.objectContaining({ width, height: height * frames, pages: frames }),
      );
      expect(metadata.delay).toEqual(Array(frames).fill(delay));
      if (width === 80 && frames === 30) {
        const decoded = await sharp(source, { animated: true })
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(decoded.info).toEqual(expect.objectContaining({ width, height: height * frames }));
        expect(decoded.data.length).toBe(width * height * frames * decoded.info.channels);
      }
      storage.download.mockResolvedValue(source);

      await service.processImage('gif-1');

      expect(prisma.media.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'gif-1', status: 'PROCESSING', deletionClaimedAt: null },
          data: expect.objectContaining({ width, height, animated: true, status: 'COMPLETED' }),
        }),
      );
      if (path === 'staging') {
        expect(storage.upload).toHaveBeenCalledWith(
          'media/master.gif',
          source,
          expect.objectContaining({ contentType: 'image/gif' }),
        );
        expect(storage.remove).toHaveBeenCalledWith('staging/source.gif');
      } else {
        expect(storage.upload.mock.calls.some(([key]) => key === 'media/master.gif')).toBe(false);
        expect(storage.remove).not.toHaveBeenCalled();
      }
      const thumbnail = storage.upload.mock.calls.find(
        ([key]) => key === 'media/master_thumb.webp',
      )![1] as Buffer;
      expect(await sharp(thumbnail).metadata()).toEqual(
        expect.objectContaining({ format: 'webp' }),
      );
      expect((await sharp(thumbnail).metadata()).pages ?? 1).toBe(1);
    },
  );

  it.each([
    [2561, 1, 1, 100, 'GIF_EDGE_LIMIT_EXCEEDED'],
    [1, 2561, 1, 100, 'GIF_EDGE_LIMIT_EXCEEDED'],
    [1, 1, 301, 100, 'GIF_FRAME_LIMIT_EXCEEDED'],
    [1, 1, 300, 210, 'GIF_DURATION_LIMIT_EXCEEDED'],
    [1000, 1000, 101, 100, 'GIF_TOTAL_PIXEL_LIMIT_EXCEEDED'],
  ])('超限 %i×%i、%i 帧、帧间隔 %i ms 应拒绝为 %s', async (width, height, frames, delay, error) => {
    storage.download.mockResolvedValue(await gif(width, height, frames, delay));

    await expect(service.processImage('gif-1')).rejects.toThrow(error);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.media.updateMany).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('APNG 应按非 GIF 多帧政策拒绝，不能静默静态化', async () => {
    prisma.media.findUnique.mockResolvedValue({
      id: 'gif-1',
      key: 'media/master.webp',
      stagingKey: path === 'staging' ? 'staging/source.png' : null,
      purpose: MediaPurpose.RICH_CONTENT,
      contentType: 'image/png',
      status: 'PROCESSING',
    });
    storage.download.mockResolvedValue(apng());
    await expect(service.processImage('gif-1')).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.media.updateMany).not.toHaveBeenCalled();
  });

  it('动态 WebP 仍应拒绝', async () => {
    const pixels = Buffer.concat([Buffer.alloc(8 * 8 * 3, 0), Buffer.alloc(8 * 8 * 3, 255)]);
    const source = await sharp(pixels, {
      raw: { width: 8, height: 16, channels: 3, pageHeight: 8 },
    })
      .webp({ delay: [100, 100] })
      .toBuffer();
    expect((await sharp(source).metadata()).pages).toBe(2);
    prisma.media.findUnique.mockResolvedValue({
      id: 'gif-1',
      key: 'media/master.webp',
      stagingKey: path === 'staging' ? 'staging/source.webp' : null,
      purpose: MediaPurpose.RICH_CONTENT,
      contentType: 'image/webp',
      status: 'PROCESSING',
    });
    storage.download.mockResolvedValue(source);

    await expect(service.processImage('gif-1')).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.media.updateMany).not.toHaveBeenCalled();
  });
});
