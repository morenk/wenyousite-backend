import { inspectImage } from '../common/image-inspection';

export const MAX_STATIC_INPUT_PIXELS = 64_000_000;
const MAX_GIF_EDGE = 2560;
const MAX_GIF_FRAMES = 300;
const MAX_GIF_DURATION_MS = 60_000;
const MAX_GIF_TOTAL_PIXELS = 100_000_000;

function detectedContentType(format?: string): string | null {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heif':
    case 'avif':
      return 'image/avif';
    default:
      return null;
  }
}

/** 两种上传入口共用媒体政策；LEGACY 没有签发 MIME，保留其历史兼容路径。 */
export async function inspectMediaImage(source: Buffer, expectedContentType?: string | null) {
  const image = await inspectImage(source, { limitInputPixels: MAX_STATIC_INPUT_PIXELS });
  const detectedType = detectedContentType(image.format);
  if (
    expectedContentType !== undefined &&
    (!detectedType || detectedType !== expectedContentType)
  ) {
    throw new Error('IMAGE_TYPE_MISMATCH');
  }
  const isGif = image.format === 'gif';
  if (!isGif && image.frameCount > 1) throw new Error('ANIMATED_IMAGE_UNSUPPORTED');
  if (isGif) {
    if (Math.max(image.frameWidth, image.frameHeight) > MAX_GIF_EDGE)
      throw new Error('GIF_EDGE_LIMIT_EXCEEDED');
    if (image.frameCount > MAX_GIF_FRAMES) throw new Error('GIF_FRAME_LIMIT_EXCEEDED');
    if (image.durationMs > MAX_GIF_DURATION_MS) throw new Error('GIF_DURATION_LIMIT_EXCEEDED');
    if (image.totalFramePixels > MAX_GIF_TOTAL_PIXELS)
      throw new Error('GIF_TOTAL_PIXEL_LIMIT_EXCEEDED');
  } else if (image.totalFramePixels > MAX_STATIC_INPUT_PIXELS) {
    throw new Error('IMAGE_PIXEL_LIMIT_EXCEEDED');
  }
  return { ...image, isGif };
}
