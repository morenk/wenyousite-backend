import sharp from 'sharp';
import { gif } from '../common/image-inspection.fixtures';
import {
  DISPLAY_MAX_INPUT_BYTES, encodeAnimationDisplay, encodeStickerDisplayFrames,
} from './media-animation-display-encoder';

async function sourceGif(
  delays = [120, 240, 360], loop = 2, duplicate = true, width = 32, height = 24,
) {
  const raw = Buffer.alloc(width * height * 4 * delays.length);
  for (let frame = 0; frame < delays.length; frame++) {
    const pattern = duplicate && frame === 1 ? 0 : frame;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = ((frame * height + y) * width + x) * 4;
      raw[offset] = pattern === 0 ? 220 : 30;
      raw[offset + 1] = pattern === 1 ? 210 : 50;
      raw[offset + 2] = pattern === 2 ? 220 : 40;
      raw[offset + 3] = x < 4 + pattern * 3 || y < 3 ? 0 : 255;
    }
  }
  return sharp(raw, {
    raw: { width, height: height * delays.length, channels: 4, pageHeight: height },
  }).gif({ delay: delays, loop, keepDuplicateFrames: true }).toBuffer();
}

function setDisposal(source: Buffer, disposal: number): Buffer {
  const result = Buffer.from(source);
  let cursor = 13 + (result[10] & 128 ? 3 * 2 ** ((result[10] & 7) + 1) : 0);
  while (cursor < result.length && result[cursor] !== 0x3b) {
    if (result[cursor] === 0x21) {
      if (result[cursor + 1] === 0xf9) {
        result[cursor + 3] = (result[cursor + 3] & ~28) | (disposal << 2);
      }
      cursor += 2;
    } else if (result[cursor] === 0x2c) {
      const packed = result[cursor + 9];
      cursor += 10 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      cursor++;
    } else throw new Error('unexpected GIF block');
    while (result[cursor]) cursor += result[cursor] + 1;
    cursor++;
  }
  return result;
}

describe('完整 GIF 展示编码的真实容器与解码回归', () => {
  it('旧动画编码会合并重复帧，新完整产物保持原首帧时长和每一帧', async () => {
    const source = await sourceGif();
    const old = await sharp(source, { animated: true })
      .webp({ loop: 2, delay: [120, 240, 360] }).toBuffer();
    expect((await sharp(old, { animated: true }).metadata()).delay).toEqual([360, 360]);

    const result = await encodeAnimationDisplay(source);
    const meta = await sharp(result.body, { animated: true }).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.pages).toBe(3);
    expect(meta.delay).toEqual([120, 240, 360]);
    expect(meta.loop).toBe(2);
    expect(result).toEqual(expect.objectContaining({
      width: 32, height: 24, frameCount: 3, durationMs: 720, loopCount: 2,
    }));
  });

  it.each([0, 1, 3])('保留有限或无限循环 %i，不把有限动画转成无限', async (loop) => {
    const result = await encodeAnimationDisplay(await sourceGif([120, 240, 360], loop));
    expect((await sharp(result.body, { animated: true }).metadata()).loop).toBe(loop);
    expect(result.loopCount).toBe(loop);
  });

  it.each([2, 3])('disposal=%i 逐帧显示与源GIF一致，透明区域不会残留上一帧', async (disposal) => {
    const source = setDisposal(await sourceGif([120, 240, 360], 2, false), disposal);
    const result = await encodeAnimationDisplay(source);
    const expected = await sharp(source, { animated: true }).ensureAlpha().raw().toBuffer();
    const actual = await sharp(result.body, { animated: true }).ensureAlpha().raw().toBuffer();
    expect(actual.length).toBe(expected.length);
    let colorError = 0;
    let opaqueChannels = 0;
    for (let offset = 0; offset < expected.length; offset += 4) {
      expect(actual[offset + 3]).toBe(expected[offset + 3]);
      if (expected[offset + 3] === 255) {
        for (let channel = 0; channel < 3; channel++) {
          colorError += (actual[offset + channel] - expected[offset + channel]) ** 2;
          opaqueChannels++;
        }
      }
    }
    expect(Math.sqrt(colorError / opaqueChannels)).toBeLessThan(20);
  });

  it('完整大图保持超过列表800档的原尺寸，即使产物较大也不会当可选预览丢弃', async () => {
    const source = await sourceGif([120, 240, 360], 2, true, 1024, 40);
    const result = await encodeAnimationDisplay(source);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(40);
    const tiny = await gif(1, 1, 2);
    const full = await encodeAnimationDisplay(tiny);
    expect(full.body.length).toBeGreaterThan(tiny.length);
    expect(full.frameCount).toBe(2);
  });

  it('单帧GIF提供静态完整WebP及统一1/0/1时序', async () => {
    const result = await encodeAnimationDisplay(await gif(4, 3, 1));
    expect(result).toEqual(expect.objectContaining({
      width: 4, height: 3, frameCount: 1, durationMs: 0, loopCount: 1,
    }));
    const meta = await sharp(result.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.pages ?? 1).toBe(1);
  });

  it('类型、损坏输入和输入预算在编码前失败，不扩大既有接收格式', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } })
      .png().toBuffer();
    await expect(encodeAnimationDisplay(png)).rejects.toThrow('DISPLAY_GIF_REQUIRED');
    await expect(encodeAnimationDisplay(Buffer.from('not an image'))).rejects.toThrow();
    await expect(encodeAnimationDisplay(Buffer.alloc(DISPLAY_MAX_INPUT_BYTES + 1)))
      .rejects.toThrow('DISPLAY_INPUT_LIMIT_EXCEEDED');
  });
});

describe('表情角色共享时间线编码但保留独立尺寸政策', () => {
  it('GIF按表情档缩小，已规范动画WebP输入也保留重复帧和循环', async () => {
    const source = await sourceGif();
    const full = await encodeAnimationDisplay(source);
    for (const input of [source, full.body]) {
      const output = await encodeStickerDisplayFrames(input, {
        maxEdge: 16, quality: 80, maxOutputBytes: 4 * 1024 * 1024, maxTotalPixels: 120_000_000,
      });
      expect(output).toEqual(expect.objectContaining({ width: 16, height: 12, frameCount: 3, loopCount: 2 }));
      expect((await sharp(output.body, { animated: true }).metadata()).delay).toEqual([120, 240, 360]);
    }
    await expect(encodeAnimationDisplay(full.body)).rejects.toThrow('ANIMATED_IMAGE_UNSUPPORTED');
  });

  it('表情输入不套用普通Media的2560边长政策，角色输出仍受512约束', async () => {
    const source = await sourceGif([120, 240, 360], 2, true, 3000, 4);
    await expect(encodeAnimationDisplay(source)).rejects.toThrow('GIF_EDGE_LIMIT_EXCEEDED');
    const result = await encodeStickerDisplayFrames(source, {
      maxEdge: 512, maxOutputBytes: 4 * 1024 * 1024, maxTotalPixels: 120_000_000,
    });
    expect(result.width).toBe(512);
    expect(result.height).toBe(1);
    expect(result.frameCount).toBe(3);
  });

  it('累计输出限制与无效配置明确失败，不返回半截容器', async () => {
    const source = await sourceGif();
    await expect(encodeStickerDisplayFrames(source, { maxOutputBytes: 64 }))
      .rejects.toThrow('DISPLAY_OUTPUT_LIMIT_EXCEEDED');
    await expect(encodeStickerDisplayFrames(source, { quality: 0 }))
      .rejects.toThrow('DISPLAY_OPTIONS_INVALID');
    await expect(encodeStickerDisplayFrames(source, { maxTotalPixels: 120_000_001 }))
      .rejects.toThrow('DISPLAY_OPTIONS_INVALID');
  });
});
