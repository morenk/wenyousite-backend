import sharp from 'sharp';
import { inspectImage } from './image-inspection';
import { apng, distinctFrames, gif, pngChunk } from './image-inspection.fixtures';

describe('单帧图像元数据边界', () => {
  it.each(['gif', 'webp'] as const)('%s 的堆叠尺寸不能泄漏给领域层', async (format) => {
    const source = await distinctFrames(format);
    expect(await sharp(source, { animated: true }).metadata()).toEqual(
      expect.objectContaining({ height: 60, pageHeight: 30, pages: 2 }),
    );
    expect(await inspectImage(source)).toEqual({
      format,
      frameWidth: 40,
      frameHeight: 30,
      frameCount: 2,
      totalFramePixels: 2400,
      durationMs: 300,
      loop: 2,
    });
  });

  it('没有图形控制扩展的合法单帧 GIF 仍可用', async () => {
    const source = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    expect(await inspectImage(source)).toEqual(
      expect.objectContaining({ frameWidth: 1, frameHeight: 1, frameCount: 1, durationMs: 100 }),
    );
  });

  it('高累计像素 GIF 只在元数据层累计一次，不触发静图单帧预算', async () => {
    expect(
      await inspectImage(await gif(1000, 1000, 100), { limitInputPixels: 64_000_000 }),
    ).toEqual(
      expect.objectContaining({
        frameWidth: 1000,
        frameHeight: 1000,
        frameCount: 100,
        totalFramePixels: 100_000_000,
      }),
    );
  });

  it('解码器仅看到首帧的 APNG 应明确拒绝', async () => {
    const source = apng();
    // 库升级若开始支持 APNG，应显式审查后调整能力策略和回归。
    expect((await sharp(source, { animated: true }).metadata()).pages).toBeUndefined();
    expect((await sharp(source).raw().toBuffer()).length).toBe(4 * 4 * 4);
    await expect(inspectImage(source)).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
  });

  it.each([false, true])('单帧 APNG（独立默认图=%s）也不能静态化', async (excluded) => {
    const source = apng(1, excluded);
    expect((await sharp(source).raw().toBuffer()).length).toBe(4 * 4 * 4);
    await expect(inspectImage(source)).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
  });

  it('动画声明的帧数为零应判为损坏容器', async () => {
    await expect(inspectImage(apng(0))).rejects.toThrow('IMAGE_METADATA_INVALID');
  });

  it('PNG 附属数据中的 acTL 文本不能误判为动画', async () => {
    const source = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const withText = Buffer.concat([
      source.subarray(0, -12),
      pngChunk('tEXt', Buffer.from('Comment\0acTL')),
      source.subarray(-12),
    ]);
    expect(await inspectImage(withText)).toEqual(
      expect.objectContaining({ frameCount: 1, frameWidth: 4, frameHeight: 4 }),
    );
  });

  it.each(['truncated', 'bad-checksum', 'out-of-bounds'] as const)(
    '损坏 PNG %s 应安全拒绝',
    async (damage) => {
      let source = apng();
      if (damage === 'truncated') source = source.subarray(0, -2);
      if (damage === 'bad-checksum') source[source.length - 1] ^= 1;
      if (damage === 'out-of-bounds') source.writeUInt32BE(0xffffffff, 8);
      await expect(inspectImage(source)).rejects.toThrow('IMAGE_METADATA_INVALID');
    },
  );

  it('真实静图仍受单帧像素上限约束', async () => {
    const source = await sharp({
      create: { width: 8001, height: 8000, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(inspectImage(source, { limitInputPixels: 64_000_000 })).rejects.toThrow(
      'Input image exceeds pixel limit',
    );
  });

  it('损坏图像不能返回缺失尺寸或 NaN 预算', async () => {
    await expect(inspectImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});
