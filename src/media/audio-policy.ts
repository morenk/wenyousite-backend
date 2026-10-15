/** 音频上传和规范播放副本的共同预算；不扩大图片预算。 */
export const AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/flac'] as const;
export const AUDIO_MAX_BYTES = 30 * 1024 * 1024;
export const AUDIO_MAX_DURATION_MS = 600_000;
export const AUDIO_FAILURE_CODES = ['AUDIO_INVALID', 'AUDIO_TOO_LONG', 'AUDIO_PROCESSING_FAILED'] as const;
export const AUDIO_UPLOAD_POLICY = {
  version: 1, maxBytes: AUDIO_MAX_BYTES, maxDurationMs: AUDIO_MAX_DURATION_MS,
  contentTypes: [...AUDIO_CONTENT_TYPES], outputContentType: 'audio/mpeg',
} as const;
