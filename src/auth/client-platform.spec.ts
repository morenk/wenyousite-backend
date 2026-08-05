import { normalizeClientPlatform, refreshTtlSeconds } from './client-platform';

describe('client platform', () => {
  it('仅接受 web/mobile，未知值按 web 归一化', () => {
    expect(normalizeClientPlatform('mobile')).toBe('mobile');
    expect(normalizeClientPlatform('web')).toBe('web');
    expect(normalizeClientPlatform('android')).toBe('web');
    expect(normalizeClientPlatform(undefined)).toBe('web');
  });

  it('返回对应 refresh token 有效期', () => {
    expect(refreshTtlSeconds('web')).toBe(7 * 24 * 60 * 60);
    expect(refreshTtlSeconds('mobile')).toBe(30 * 24 * 60 * 60);
  });
});
