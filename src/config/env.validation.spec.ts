import 'reflect-metadata';
import { validate } from './env.validation';

describe('环境变量校验', () => {
  const databaseUrl = 'postgresql://user:pass@127.0.0.1:5432/test';

  it('开发环境使用与运行配置一致的数据库默认值', () => {
    expect(validate({}).DATABASE_URL).toBe(
      'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyousite?schema=public',
    );
  });

  it('隐式转换数字并应用默认值', () => {
    const result = validate({
      DATABASE_URL: databaseUrl,
      PORT: '4100',
      REDIS_PORT: '6380',
      AUTH_REFRESH_WEB_TTL_DAYS: '14',
    });

    expect(result).toEqual(
      expect.objectContaining({
        NODE_ENV: 'development',
        DATABASE_URL: databaseUrl,
        PORT: 4100,
        REDIS_PORT: 6380,
        AUTH_REFRESH_WEB_TTL_DAYS: 14,
        AUTH_REFRESH_MOBILE_TTL_DAYS: 30,
        PUSH_ENABLED: false,
        MOBILE_PUSH_TTL_SECONDS: 86_400,
      }),
    );
  });

  it.each([
    ['false', false],
    ['true', true],
    [false, false],
    [true, true],
  ])('正确解析 PUSH_ENABLED=%p', (value, expected) => {
    expect(validate({ DATABASE_URL: databaseUrl, PUSH_ENABLED: value }).PUSH_ENABLED).toBe(
      expected,
    );
  });

  it('拒绝模糊布尔值、未知环境和小于一天的刷新周期', () => {
    expect(() => validate({ DATABASE_URL: databaseUrl, PUSH_ENABLED: 'yes' })).toThrow();
    expect(() => validate({ DATABASE_URL: databaseUrl, NODE_ENV: 'staging' })).toThrow();
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        AUTH_REFRESH_WEB_TTL_DAYS: '0',
      }),
    ).toThrow();
  });

  it.each([undefined, '', 'dev-access-secret', 'change-me-please-use-another-secret', 'too-short'])(
    '生产环境拒绝默认或过短 JWT 密钥：%p',
    (secret) => {
      expect(() =>
        validate({
          DATABASE_URL: databaseUrl,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: secret,
        }),
      ).toThrow('生产环境 JWT_ACCESS_SECRET');
    },
  );

  it('生产环境启用推送时要求项目和凭证路径同时存在', () => {
    const base = {
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'production-random-secret-at-least-24-chars',
      PUSH_ENABLED: 'true',
    };

    expect(() => validate(base)).toThrow('启用推送时必须配置');
    expect(() => validate({ ...base, FIREBASE_PROJECT_ID: 'project-1' })).toThrow(
      '启用推送时必须配置',
    );
  });

  it('有效生产配置通过且字符串 false 不会误开启推送', () => {
    expect(
      validate({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'production-random-secret-at-least-24-chars',
        PUSH_ENABLED: 'false',
      }),
    ).toEqual(
      expect.objectContaining({
        NODE_ENV: 'production',
        PUSH_ENABLED: false,
      }),
    );

    expect(
      validate({
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'production-random-secret-at-least-24-chars',
        PUSH_ENABLED: 'true',
        FIREBASE_PROJECT_ID: 'project-1',
        GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase.json',
      }).PUSH_ENABLED,
    ).toBe(true);
  });

  it('接受分平台移动构建策略和 HTTPS 更新地址', () => {
    const result = validate({
      DATABASE_URL: databaseUrl,
      MOBILE_ANDROID_MIN_SUPPORTED_BUILD: '120',
      MOBILE_ANDROID_RECOMMENDED_BUILD: '135',
      MOBILE_ANDROID_UPDATE_URL: 'https://play.google.com/store/apps/details?id=site.wenyou',
      MOBILE_IOS_RECOMMENDED_BUILD: '90',
      MOBILE_IOS_UPDATE_URL: 'https://apps.apple.com/app/id123456789',
    });

    expect(result).toEqual(
      expect.objectContaining({
        MOBILE_ANDROID_MIN_SUPPORTED_BUILD: '120',
        MOBILE_ANDROID_RECOMMENDED_BUILD: '135',
        MOBILE_IOS_RECOMMENDED_BUILD: '90',
      }),
    );
  });

  it('拒绝非法构建号、推荐值倒挂和缺失或非 HTTPS 的更新地址', () => {
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_ANDROID_MIN_SUPPORTED_BUILD: '0',
      }),
    ).toThrow();
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_ANDROID_MIN_SUPPORTED_BUILD: '120',
        MOBILE_ANDROID_RECOMMENDED_BUILD: '119',
        MOBILE_ANDROID_UPDATE_URL: 'https://wenyou.site/download',
      }),
    ).toThrow('推荐构建号不能低于最低支持构建号');
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_IOS_RECOMMENDED_BUILD: '90',
      }),
    ).toThrow('必须提供 HTTPS 更新地址');
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_IOS_RECOMMENDED_BUILD: '90',
        MOBILE_IOS_UPDATE_URL: 'http://wenyou.site/download',
      }),
    ).toThrow();
  });

  it('限制移动推送 TTL 为 60 秒至 28 天', () => {
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_PUSH_TTL_SECONDS: '59',
      }),
    ).toThrow();
    expect(() =>
      validate({
        DATABASE_URL: databaseUrl,
        MOBILE_PUSH_TTL_SECONDS: String(28 * 24 * 60 * 60 + 1),
      }),
    ).toThrow();
  });
});
