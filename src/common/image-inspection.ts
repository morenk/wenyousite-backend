import { crc32 } from 'node:zlib';
import sharp from 'sharp';

export interface ImageInspection {
  format: string | undefined;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  totalFramePixels: number;
  durationMs: number;
  loop: number | undefined;
}

function invalidMetadata(): never {
  throw new Error('IMAGE_METADATA_INVALID');
}

// libvips 的 PNG 解码器可能仅报告首帧；从有边界、带校验的 chunk 读取动画声明。
function pngFrameCount(source: Buffer): number | undefined {
  if (!source.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return;
  let offset = 8;
  let frames: number | undefined;
  let imageDataSeen = false;
  while (offset < source.length) {
    if (source.length - offset < 12) invalidMetadata();
    const length = source.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > source.length) invalidMetadata();
    const type = source.toString('ascii', offset + 4, offset + 8);
    if (crc32(source.subarray(offset + 4, end - 4)) !== source.readUInt32BE(end - 4)) {
      invalidMetadata();
    }
    if (type === 'acTL') {
      if (length !== 8 || frames !== undefined || imageDataSeen) invalidMetadata();
      frames = source.readUInt32BE(offset + 8);
      if (frames < 1) invalidMetadata();
    }
    if (type === 'IDAT') imageDataSeen = true;
    if (type === 'IEND') {
      if (length !== 0 || !imageDataSeen) invalidMetadata();
      return frames;
    }
    offset = end;
  }
  return invalidMetadata();
}

/** 只暴露单帧尺寸及一次累计后的像素量，不让业务层消费 sharp 的堆叠 height。 */
export async function inspectImage(
  source: Buffer,
  options: { limitInputPixels?: number } = {},
): Promise<ImageInspection> {
  const pngFrames = pngFrameCount(source);
  // 当前解码器不支持 APNG 动画；单帧 APNG 也可能有独立的默认图，不能视作静图。
  if (pngFrames !== undefined) throw new Error('ANIMATED_IMAGE_UNSUPPORTED');
  const metadata = await sharp(source, { ...options, animated: false }).metadata();
  const frameWidth = metadata.width;
  const frameHeight = metadata.height;
  const frameCount = metadata.pages ?? 1;
  if (!frameWidth || !frameHeight) throw new Error('IMAGE_DIMENSIONS_MISSING');
  if (
    ![frameWidth, frameHeight, frameCount].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    invalidMetadata();
  }
  const delays = metadata.delay ?? [];
  if (!delays.every((delay) => Number.isSafeInteger(delay) && delay >= 0)) invalidMetadata();
  const durationMs = delays.reduce((sum, delay) => sum + delay, 0);
  const totalFramePixels = frameWidth * frameHeight * frameCount;
  if (!Number.isSafeInteger(durationMs) || !Number.isSafeInteger(totalFramePixels))
    invalidMetadata();
  return {
    format: metadata.format,
    frameWidth,
    frameHeight,
    frameCount,
    totalFramePixels,
    durationMs,
    loop: metadata.loop,
  };
}
