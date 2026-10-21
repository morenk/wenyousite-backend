import { DynamicFontRuntimePolicyDto } from './dto/font-runtime.dto';

const network = {
  windowMs: 60000,
  maxRequests: 64,
  timeoutMode: 'idle-with-total-cap' as const,
  timeoutMs: 15000,
  maxTransferMs: 600000,
};
export const DYNAMIC_FONT_RUNTIME_POLICY: DynamicFontRuntimePolicyDto = {
  policyVersion: 3,
  fontVersion: 2,
  web: {
    network: { ...network, maxBytes: 16777216, maxConcurrent: 2 },
    residency: { mode: 'lease-lru', scope: 'document', maxFaces: 64, maxSfntBytes: 16777216 },
  },
  mobile: {
    network: { ...network, maxBytes: 25165824, maxConcurrent: 1 },
    registration: {
      mode: 'append-only',
      scope: 'engine',
      key: 'asset-sha256-and-family',
      maxAttemptsPerKey: 1,
      failedAttempt: 'quarantine-and-retain-charge',
      maxKeys: 1024,
      maxInputBytes: 67108864,
    },
  },
  retry: {
    delayCeilingsMs: [1000, 2000, 4000, 8000, 16000, 32000, 60000],
    jitter: 'full',
    retryableHttpStatuses: [408, 429, 500, 502, 503, 504],
    retryNetworkErrors: true,
    retryTimeouts: true,
    respectRetryAfter: true,
  },
  metadata: {
    revalidateAfterMs: 300000,
    negativeCacheMs: 30000,
    reservationBytes: 65536,
    revalidateOnForeground: true,
    revalidateOnPickerOpen: true,
    coalesceUnknownVersions: true,
  },
  diskCacheBytes: 67108864,
};
