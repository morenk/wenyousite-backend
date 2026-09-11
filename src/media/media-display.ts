import { MediaDisplayResponseDto } from './dto/media-display.dto';

/** 不允许 JSON 元数据把未验证的地址、尺寸或静态时序声明成完整动画。 */
export function readMediaDisplay(value: unknown): MediaDisplayResponseDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.url !== 'string' || item.contentType !== 'image/webp' ||
    typeof item.animated !== 'boolean') return null;
  try {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch { return null; }
  const positive = ['width', 'height', 'bytes', 'frameCount'] as const;
  const nonnegative = ['durationMs', 'loopCount'] as const;
  if (!positive.every((key) => Number.isSafeInteger(item[key]) && Number(item[key]) > 0) ||
    !nonnegative.every((key) => Number.isSafeInteger(item[key]) && Number(item[key]) >= 0)) return null;
  if (item.animated && Number(item.frameCount) < 2) return null;
  if (!item.animated && (item.frameCount !== 1 || item.durationMs !== 0 || item.loopCount !== 1)) return null;
  return {
    url: item.url, contentType: 'image/webp', animated: item.animated,
    width: Number(item.width), height: Number(item.height), bytes: Number(item.bytes),
    frameCount: Number(item.frameCount), durationMs: Number(item.durationMs), loopCount: Number(item.loopCount),
  };
}
