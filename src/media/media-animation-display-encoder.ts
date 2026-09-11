import sharp from 'sharp';
import { ImageInspection, inspectImage } from '../common/image-inspection';
import { inspectMediaImage } from './media-image-inspection';

export const DISPLAY_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const DISPLAY_MAX_TOTAL_PIXELS = 100_000_000;
export const DISPLAY_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DISPLAY_QUALITY = 80;

export interface EncodedAnimationDisplay {
  body: Buffer;
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  loopCount: number;
}

function chunk(type: string, payload: Buffer): Buffer {
  const result = Buffer.alloc(8 + payload.length + (payload.length % 2));
  result.write(type, 0, 'ascii');
  result.writeUInt32LE(payload.length, 4);
  payload.copy(result, 8);
  return result;
}

function stillFrameChunks(body: Buffer): { data: Buffer; alpha: boolean } {
  if (body.length < 12 || body.toString('ascii', 0, 4) !== 'RIFF' ||
      body.toString('ascii', 8, 12) !== 'WEBP' || body.readUInt32LE(4) + 8 !== body.length) {
    throw new Error('DISPLAY_FRAME_INVALID');
  }
  const chunks: Buffer[] = [];
  let imageCount = 0;
  let alpha = false;
  for (let offset = 12; offset < body.length;) {
    if (offset + 8 > body.length) throw new Error('DISPLAY_FRAME_INVALID');
    const length = body.readUInt32LE(offset + 4);
    const end = offset + 8 + length + length % 2;
    if (end > body.length) throw new Error('DISPLAY_FRAME_INVALID');
    const type = body.toString('ascii', offset, offset + 4);
    if (type === 'ALPH') alpha = true;
    if (type === 'VP8L') {
      if (length < 5) throw new Error('DISPLAY_FRAME_INVALID');
      alpha ||= (body[offset + 12] & 0x10) !== 0;
    }
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L') {
      chunks.push(body.subarray(offset, end));
      if (type !== 'ALPH') imageCount++;
    }
    offset = end;
  }
  if (imageCount !== 1) throw new Error('DISPLAY_FRAME_INVALID');
  return { data: Buffer.concat(chunks), alpha };
}

/**
 * 在调用方可杀死的子进程中运行。逐页解码保留 GIF disposal 合成，避免分配所有帧的 RGBA。
 * libwebp 动画优化会合并相同帧，因此按 WebP ANMF 规范写入全画布 no-blend 帧。
 * https://developers.google.com/speed/webp/docs/riff_container#animation
 */
async function encodeDisplayFrames(
  source: Buffer, input: ImageInspection, options: DisplayFrameOptions,
): Promise<EncodedAnimationDisplay> {
  const pixelLimit = options.maxTotalPixels ?? DISPLAY_MAX_TOTAL_PIXELS;
  const outputLimit = options.maxOutputBytes ?? DISPLAY_MAX_OUTPUT_BYTES;
  const quality = options.quality ?? DISPLAY_QUALITY;
  if (!Number.isSafeInteger(pixelLimit) || pixelLimit < 1 || pixelLimit > 120_000_000 ||
      !Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > DISPLAY_MAX_OUTPUT_BYTES ||
      !Number.isSafeInteger(quality) || quality < 1 || quality > 100 ||
      (options.maxEdge !== undefined && (!Number.isSafeInteger(options.maxEdge) ||
        options.maxEdge < 1 || options.maxEdge > 2560))) {
    throw new Error('DISPLAY_OPTIONS_INVALID');
  }
  if (input.totalFramePixels > pixelLimit) throw new Error('DISPLAY_PIXEL_LIMIT_EXCEEDED');
  const scale = Math.min(1, (options.maxEdge ?? Math.max(input.frameWidth, input.frameHeight)) /
    Math.max(input.frameWidth, input.frameHeight));
  const width = Math.max(1, Math.round(input.frameWidth * scale));
  const height = Math.max(1, Math.round(input.frameHeight * scale));
  const animated = input.frameCount > 1;
  const delays = animated ? input.frameDelaysMs : [0];
  const loopCount = animated ? input.loop ?? 1 : 1;
  if (delays.length !== input.frameCount ||
      !delays.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffff) ||
      !Number.isSafeInteger(loopCount) || loopCount < 0 || loopCount > 0xffff) {
    throw new Error('DISPLAY_TIMELINE_INVALID');
  }

  sharp.concurrency(1);
  sharp.cache(false);
  const frames: Buffer[] = [];
  // RIFF 12 + VP8X 18 + ANIM 14；每帧在加入集合前检查，避免累计无界输出。
  let outputBytes = animated ? 44 : 0;
  let alpha = false;
  let singleFrame: Buffer | undefined;
  for (let page = 0; page < input.frameCount; page++) {
    const pipeline = sharp(source, { page, pages: 1, limitInputPixels: pixelLimit });
    if (options.maxEdge !== undefined) pipeline.resize(options.maxEdge, options.maxEdge, { fit: 'inside', withoutEnlargement: true });
    const still = await pipeline.webp({ quality, alphaQuality: 100, effort: 4 }).toBuffer();
    if (!animated) {
      if (still.length > outputLimit) throw new Error('DISPLAY_OUTPUT_LIMIT_EXCEEDED');
      singleFrame = still;
      break;
    }
    const parts = stillFrameChunks(still);
    alpha ||= parts.alpha;
    const header = Buffer.alloc(16);
    header.writeUIntLE(width - 1, 6, 3);
    header.writeUIntLE(height - 1, 9, 3);
    header.writeUIntLE(delays[page], 12, 3);
    // 当前页已是完整合成画布；覆盖整帧使透明像素可清除上一帧，无需跨帧 blend/disposal。
    header[15] = 2;
    const frameBytes = 8 + header.length + parts.data.length;
    if (outputBytes + frameBytes > outputLimit) {
      throw new Error('DISPLAY_OUTPUT_LIMIT_EXCEEDED');
    }
    const frame = chunk('ANMF', Buffer.concat([header, parts.data]));
    outputBytes += frame.length;
    frames.push(frame);
  }

  let body: Buffer;
  if (singleFrame) {
    body = singleFrame;
  } else {
    const extended = Buffer.alloc(10);
    extended[0] = 0x02 | (alpha ? 0x10 : 0);
    extended.writeUIntLE(width - 1, 4, 3);
    extended.writeUIntLE(height - 1, 7, 3);
    const animation = Buffer.alloc(6);
    animation.writeUInt16LE(loopCount, 4);
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(outputBytes - 8, 4);
    riff.write('WEBP', 8, 'ascii');
    body = Buffer.concat([riff, chunk('VP8X', extended), chunk('ANIM', animation), ...frames]);
  }
  const output = await inspectImage(body, { limitInputPixels: pixelLimit });
  if (body.length > outputLimit || output.format !== 'webp' ||
      output.frameWidth !== width || output.frameHeight !== height ||
      output.frameCount !== input.frameCount ||
      (animated && (JSON.stringify(output.frameDelaysMs) !== JSON.stringify(delays) ||
        (output.loop ?? 1) !== loopCount))) {
    throw new Error('DISPLAY_OUTPUT_VALIDATION_FAILED');
  }
  return {
    body, width, height, frameCount: input.frameCount,
    durationMs: animated ? input.durationMs : 0, loopCount,
  };
}

export interface DisplayFrameOptions {
  maxEdge?: number;
  quality?: number;
  maxOutputBytes?: number;
  maxTotalPixels?: number;
}

/** 普通媒体入口保留原 GIF 接收政策与原尺寸，不允许调用方缩小完整展示产物。 */
export async function encodeAnimationDisplay(source: Buffer): Promise<EncodedAnimationDisplay> {
  if (source.length > DISPLAY_MAX_INPUT_BYTES) throw new Error('DISPLAY_INPUT_LIMIT_EXCEEDED');
  const input = await inspectMediaImage(source);
  if (!input.isGif) throw new Error('DISPLAY_GIF_REQUIRED');
  return encodeDisplayFrames(source, input, {});
}

/** 表情调用方先验证其独立用途/帧数/时长预算；共享容器实现，不改变 Media 接收格式。 */
export async function encodeStickerDisplayFrames(
  source: Buffer, options: DisplayFrameOptions,
): Promise<EncodedAnimationDisplay> {
  if (source.length > DISPLAY_MAX_INPUT_BYTES) throw new Error('DISPLAY_INPUT_LIMIT_EXCEEDED');
  const input = await inspectImage(source, { limitInputPixels: 120_000_000 });
  if (input.format !== 'gif' && input.format !== 'webp') throw new Error('DISPLAY_ANIMATION_FORMAT_REQUIRED');
  if (input.frameCount > 120 || input.durationMs > 15_000) throw new Error('DISPLAY_STICKER_TIMELINE_LIMIT');
  return encodeDisplayFrames(source, input, options);
}

/** 可选列表档位共享完整帧容器，但保持既有 32MP 和 480/800 档位预算。 */
export async function encodePreviewDisplayFrames(source: Buffer, edge: number): Promise<EncodedAnimationDisplay> {
  if (source.length > DISPLAY_MAX_INPUT_BYTES || ![480, 800].includes(edge)) throw new Error('PREVIEW_INPUT_INVALID');
  const input = await inspectMediaImage(source);
  if (!input.isGif) throw new Error('DISPLAY_GIF_REQUIRED');
  return encodeDisplayFrames(source, input, { maxEdge: edge, quality: 75, maxTotalPixels: 32_000_000 });
}
