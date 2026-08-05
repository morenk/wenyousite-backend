/** 双端登录平台：浏览器（含手机网页）与原生移动客户端各使用一个终端槽位。 */
export const CLIENT_PLATFORMS = ['web', 'mobile'] as const;

export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

/** 将客户端声明规范化；未知或缺失值按浏览器处理，避免制造任意平台槽位。 */
export function normalizeClientPlatform(value: unknown): ClientPlatform {
  return value === 'mobile' ? 'mobile' : 'web';
}

export function refreshTtlSeconds(platform: ClientPlatform) {
  return platform === 'mobile' ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
}
