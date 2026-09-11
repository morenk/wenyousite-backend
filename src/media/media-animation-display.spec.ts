import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAnimationDisplay } from './media-animation-display';
import { inspectImage } from '../common/image-inspection';

describe('完整展示独立Node子进程', () => {
  const source = readFileSync(join(__dirname, '../../contracts/fixtures/media-display/duplicate-frames.gif'));
  it('真实IPC返回完整重复帧及有限循环，体积增大也返回，主进程无帧解码', async () => {
    const result = await generateAnimationDisplay(source);
    expect(result).toMatchObject({ width: 24, height: 16, frameCount: 3, durationMs: 1500, loopCount: 2 });
    expect(result.body.length).toBeGreaterThan(source.length);
    expect(await inspectImage(result.body)).toMatchObject({ frameDelaysMs: [300, 600, 600], loop: 2 });
  }, 15_000);
  it('表情模式接受已有动画WebP并保留完整时间线', async () => {
    const webp = readFileSync(join(__dirname, '../../contracts/fixtures/media-display/duplicate-frames.webp'));
    const result = await generateAnimationDisplay(webp, 'sticker');
    expect(await inspectImage(result.body)).toMatchObject({ frameCount: 3, frameDelaysMs: [300, 600, 600], loop: 2 });
  }, 15_000);
  it('真实子进程硬截止后退出并释放槽，不允许调用方放大资源预算', async () => {
    const started = Date.now();
    await expect(generateAnimationDisplay(source, 'media', 10)).rejects.toThrow('DISPLAY_ENCODING_FAILED');
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(generateAnimationDisplay(source, 'media', 60_001)).rejects.toThrow('DISPLAY_BUDGET_INVALID');
    expect((await generateAnimationDisplay(source)).frameCount).toBe(3);
  }, 15_000);
  it('损坏输入、超预算、常规Media不支持动画WebP均明确失败，下一任务仍可执行', async () => {
    await expect(generateAnimationDisplay(Buffer.from('broken'))).rejects.toThrow('DISPLAY_ENCODING_FAILED');
    await expect(generateAnimationDisplay(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow('DISPLAY_INPUT_LIMIT');
    const webp = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).webp().toBuffer();
    await expect(generateAnimationDisplay(webp)).rejects.toThrow('DISPLAY_GIF_REQUIRED');
    expect((await generateAnimationDisplay(source)).frameCount).toBe(3);
  }, 20_000);
});
