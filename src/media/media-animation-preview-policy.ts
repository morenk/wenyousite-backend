
import { MediaPurpose } from '@prisma/client';

export const PREVIEW_EDGES = [480, 800] as const;
export const PREVIEW_QUALITY = 75;
export const PREVIEW_BUDGET_MS = 8_000;
export const PREVIEW_JOB_BUDGET_MS = 20_000;
export const PREVIEW_MAX_PIXELS = 32_000_000;
export const PREVIEW_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const PREVIEW_MAX_RSS_BYTES = 512 * 1024 * 1024;
export type PreviewEdge = (typeof PREVIEW_EDGES)[number];
export type PreviewDescriptor = { url: string; width: number; height: number; bytes: number };
export type EncodedPreview = { edge: PreviewEdge; width: number; height: number; body: Buffer };

export function supportsAnimationPreview(purpose: string | null | undefined): boolean {
  return purpose === MediaPurpose.RICH_CONTENT || purpose === MediaPurpose.LEGACY;
}

/** 每次尝试 UUID 隔离对象 key；发布后 URL 不变，策略升级使用新版本前缀。 */
export function animationPreviewKey(key: string, attemptId: string, edge: PreviewEdge): string {
  return key.replace(/\.[^.]+$/, '_preview_v1_' + attemptId + '_' + edge + '.webp');
}

export function readPreviewDescriptors(value: unknown): PreviewDescriptor[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const result: PreviewDescriptor[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url ||
      ![item.width, item.height, item.bytes].every((n) => Number.isSafeInteger(n) && n > 0) ||
      Math.max(item.width, item.height) > 800 ||
      result.some((previous) => previous.url === item.url ||
        previous.width === item.width && previous.height === item.height)) return null;
    result.push({ url: item.url, width: item.width, height: item.height, bytes: item.bytes });
  }
  return result.sort((a, b) => a.width * a.height - b.width * b.height);
}
