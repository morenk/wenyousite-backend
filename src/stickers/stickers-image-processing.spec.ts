import { Queue } from 'bullmq';
import sharp from 'sharp';
import { ThreadAccessService } from '../access/thread-access.service';
import { inspectImage } from '../common/image-inspection';
import { apng, distinctFrames, gif } from '../common/image-inspection.fixtures';
import { PrismaService } from '../prisma/prisma.service';
import { StickerContentService } from './sticker-content.service';
import { StickerStorageService } from './sticker-storage.service';
import { StickersService } from './stickers.service';

type Normalized = {
  main: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
  animated: boolean;
  frameCount: number;
  durationMs: number;
};
const service = new StickersService(
  {} as PrismaService,
  {} as ThreadAccessService,
  {} as StickerContentService,
  {} as StickerStorageService,
  {} as Queue,
) as unknown as { normalize(input: Buffer): Promise<Normalized> };

describe('表情真实编码处理', () => {
  it.each(['gif', 'webp'] as const)(
    '%s 转为动画 WebP 后保留单帧尺寸、帧数、时长和循环',
    async (format) => {
      const result = await service.normalize(await distinctFrames(format));
      expect(result).toEqual(
        expect.objectContaining({
          width: 40,
          height: 30,
          animated: true,
          frameCount: 2,
          durationMs: 300,
        }),
      );
      expect(await inspectImage(result.main)).toEqual(
        expect.objectContaining({
          format: 'webp',
          frameWidth: 40,
          frameHeight: 30,
          frameCount: 2,
          durationMs: 300,
          loop: 2,
        }),
      );
      expect(await inspectImage(result.thumbnail)).toEqual(
        expect.objectContaining({ frameCount: 1 }),
      );
      expect((await sharp(result.main, { animated: true }).raw().toBuffer()).length).toBe(
        40 * 30 * 2 * 3,
      );
    },
  );

  it('静图旋转后的输出尺寸入库，不能沿用输入方向', async () => {
    const source = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#336699' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await service.normalize(source);
    expect(result).toEqual(
      expect.objectContaining({
        width: 256,
        height: 512,
        animated: false,
        frameCount: 1,
        durationMs: 0,
      }),
    );
    expect(await inspectImage(result.main)).toEqual(
      expect.objectContaining({ frameWidth: 256, frameHeight: 512 }),
    );
  });

  it('APNG 不能静默转成静态表情', async () => {
    await expect(service.normalize(apng())).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
  });

  it.each([
    [1, 1, 121, 100, '动图不能超过 120 帧'],
    [1, 1, 100, 160, '动图不能超过 15 秒'],
    [1001, 1000, 120, 100, '图片像素尺寸过大'],
  ])('保留独立的表情预算 %i×%i×%i/%i', async (width, height, frames, delay, error) => {
    await expect(service.normalize(await gif(width, height, frames, delay))).rejects.toThrow(error);
  });

  it('真实静图保留表情独立的 40MP 预算', async () => {
    const source = await sharp({
      create: { width: 8001, height: 5000, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(service.normalize(source)).rejects.toThrow('图片像素尺寸过大');
  });

  it('媒体可接受的长动画仍按表情 15 秒预算拒绝', async () => {
    await expect(service.normalize(await gif(80, 100, 100, 200))).rejects.toThrow(
      '动图不能超过 15 秒',
    );
  });
});
