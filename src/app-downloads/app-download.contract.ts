export const DOWNLOAD_PREFIX = '/api/v1/app-downloads';
export const APK_MEDIA_TYPE = 'application/vnd.android.package-archive';
export const ANDROID_APPLICATION_ID = 'site.wenyou.app';
export const DOWNLOAD_SOCKET = '/run/wenyousite-download/gateway.sock';
export const DOWNLOAD_LIMITS = Object.freeze({
  globalBytesPerSecond: 500_000,
  connectionBytesPerSecond: 250_000,
  globalConnections: 4,
  ipConnections: 2,
  requestsPerMinute: 30,
  deviceDownloadsPerDay: 3,
  ipDownloadsPerDay: 10,
  quotaSubjectsPerDay: 100_000,
  outboundDayBytes: 5 * 1024 ** 3,
  outboundMonthBytes: 100 * 1024 ** 3,
  originDayBytes: 512 * 1024 ** 2,
  originMonthBytes: 2 * 1024 ** 3,
  cacheBytes: 1024 ** 3,
  maxArtifactBytes: 512 * 1024 ** 2,
});

export function downloadUrl(buildNumber: number): string {
  return `https://wenyou.site${DOWNLOAD_PREFIX}/android/${buildNumber}/file`;
}
export const DOWNLOAD_COOKIE_HEADER = {
  'Set-Cookie': {
    schema: { type: 'string' },
    description:
      '可选：第一方签名随机浏览器标识；HttpOnly、SameSite=Lax，生产 Secure；不是用户认证，旧 APP 可忽略',
  },
};
export const DOWNLOAD_LIMIT_HEADERS = {
  'Retry-After': {
    schema: { type: 'integer', minimum: 1 },
    description: '重试等待秒数；设备/IP 每日次数耗尽时到北京时间下一日',
  },
  'X-Download-Limit-Reason': {
    schema: {
      type: 'string',
      enum: [
        'device_daily_limit',
        'ip_daily_limit',
        'byte_budget',
        'request_rate',
        'concurrency',
        'bandwidth',
      ],
    },
    description: '脱敏机器原因；HEAD 无正文，GET 错误正文也可能为空',
  },
};

export const APK_RESPONSE_HEADERS = {
  ...DOWNLOAD_COOKIE_HEADER,
  'Content-Type': { schema: { type: 'string', enum: [APK_MEDIA_TYPE] } },
  'Content-Length': {
    schema: { type: 'integer', minimum: 0 },
    description: '本次响应正文长度；HEAD 同 GET',
  },
  'Content-Disposition': {
    schema: { type: 'string' },
    description: 'attachment; filename="wenyou-<version>-<build>.apk"',
  },
  'Cache-Control': {
    schema: { type: 'string' },
    description: 'private, no-store；禁止代理缓存绕过预算',
  },
  'Accept-Ranges': { schema: { type: 'string', enum: ['bytes'] } },
  ETag: { schema: { type: 'string' }, description: '双引号包围的 SHA-256' },
  'Last-Modified': { schema: { type: 'string' }, description: '发布时间，HTTP-date' },
  'x-amz-meta-apk-sha256': { schema: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
  'x-amz-meta-application-id': { schema: { type: 'string', enum: [ANDROID_APPLICATION_ID] } },
  'x-amz-meta-version-name': { schema: { type: 'string' } },
  'x-amz-meta-version-code': { schema: { type: 'string' } },
};
