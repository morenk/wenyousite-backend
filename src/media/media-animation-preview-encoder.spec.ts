
import sharp from 'sharp';
import { gif } from '../common/image-inspection.fixtures';
import { encodeAnimationPreviews } from './media-animation-preview-encoder';
import { generateAnimationPreviews } from './media-animation-preview';

const delays = [40, 120, 70, 200, 90, 150];
/** 构造纹理、移动透明区域与不同帧延迟；不是用户真实素材。 */
async function sample(width: number, height: number, disposal: number) {
  const pixels = Buffer.alloc(width * height * 4 * delays.length);
  for (let frame = 0; frame < delays.length; frame++) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = ((frame * height + y) * width + x) * 4;
      pixels[offset] = (x + frame * 17) % 256;
      pixels[offset + 1] = (y + frame * 31) % 256;
      pixels[offset + 2] = (x + y + frame * 9) % 256;
      pixels[offset + 3] = x < width / 5 + frame * 3 || y < height / 7 ? 0 : 255;
    }
  }
  const source = await sharp(pixels, { raw: { width, height: height * delays.length, channels: 4, pageHeight: height } })
    .gif({ delay: delays, loop: 3, effort: 7 }).toBuffer();
  // 解析容器块后明确设置 GCE disposal，避免匹配压缩像素中的偶然字节。
  let cursor = 13 + (source[10] & 0x80 ? 3 * 2 ** ((source[10] & 7) + 1) : 0);
  const disposals: number[] = [];
  while (cursor < source.length && source[cursor] !== 0x3b) {
    if (source[cursor] === 0x21) {
      if (source[cursor + 1] === 0xf9) {
        source[cursor + 3] = (source[cursor + 3] & ~28) | (disposal << 2);
        disposals.push((source[cursor + 3] >> 2) & 7);
      }
      cursor += 2;
    } else if (source[cursor] === 0x2c) {
      const packed = source[cursor + 9];
      cursor += 10 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      cursor++;
    } else throw new Error('unexpected GIF block');
    while (source[cursor]) cursor += source[cursor] + 1;
    cursor++;
  }
  expect(disposals).toEqual(delays.map(() => disposal));
  return source;
}

describe('真实 GIF 到动画 WebP 编解码边界', () => {
  it.each([[160, 100, 2], [300, 900, 3]])('完整解码逐帧验证 %ix%i disposal=%i 的比例、透明、画面和时间线', async (width, height, disposal) => {
    const source = await sample(width, height, disposal);
    const variants = await encodeAnimationPreviews(source);
    expect(variants.length).toBe(width === 160 ? 1 : 2);
    const sourceMeta = await sharp(source, { animated: true }).metadata();
    for (const variant of variants) {
      expect(variant.body.length).toBeLessThan(source.length);
      const metadata = await sharp(variant.body, { animated: true }).metadata();
      expect(metadata.delay).toEqual(delays);
      expect(metadata.loop).toBe(3);
      expect(metadata.pages).toBe(delays.length);
      expect(metadata.pageHeight).toBe(variant.height);
      expect(metadata.width).toBe(variant.width);
      expect(variant.width / variant.height).toBeCloseTo(width / height, 2);
      expect(sourceMeta.delay).toEqual(metadata.delay);
      const expected = await sharp(source, { animated: true }).resize(variant.edge, variant.edge, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer();
      const actual = await sharp(variant.body, { animated: true }).ensureAlpha().raw().toBuffer();
      expect(actual.length).toBe(expected.length);
      const frameBytes = variant.width * variant.height * 4;
      for (let frame = 0; frame < delays.length; frame++) {
        let alphaError = 0, rgbError = 0, count = 0;
        for (let offset = frame * frameBytes; offset < (frame + 1) * frameBytes; offset += 4) {
          alphaError += Math.abs(actual[offset + 3] - expected[offset + 3]);
          if (expected[offset + 3] > 240) {
            for (let channel = 0; channel < 3; channel++) rgbError += (actual[offset + channel] - expected[offset + channel]) ** 2;
            count += 3;
          }
        }
        expect(alphaError / (frameBytes / 4)).toBeLessThan(0.1);
        expect(Math.sqrt(rgbError / count)).toBeLessThan(22);
      }
    }
  }, 15_000);

  it('真实隔离子进程可返回结果，小原图不放大且重复尺寸只发一份', async () => {
    const source = await sample(160, 100, 2);
    const variants = await generateAnimationPreviews(source, Date.now() + 8_000);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual(expect.objectContaining({ width: 160, height: 100 }));
  }, 10_000);

  it('超累计像素预算及无体积收益安全放弃，不改变原上传政策', async () => {
    expect(await encodeAnimationPreviews(await gif(1000, 1000, 33))).toEqual([]);
    expect(await encodeAnimationPreviews(await gif(1, 1, 2))).toEqual([]);
  });
});
