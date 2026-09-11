export const DISPLAY_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const DISPLAY_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DISPLAY_MAX_RSS_BYTES = 512 * 1024 * 1024;
export const DISPLAY_ENCODING_MS = 60_000;
export const DISPLAY_UPLOAD_MS = 30_000;

export function animationDisplayKey(sourceKey: string, attemptId: string) {
  return sourceKey.replace(/(\.[^.]+)$/, `_display_v1_${attemptId}.webp`);
}
