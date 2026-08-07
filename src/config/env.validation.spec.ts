import 'reflect-metadata';
import { validate } from './env.validation';

describe('环境变量校验', () => {
  const databaseUrl = 'postgresql://user:pass@127.0.0.1:5432/test';

  it('要求提供数据库连接串', () => {
    expect(() => validate({})).toThrow('DATABASE_URL');
  });

  it('隐式转换数字并应用默认值', () => {
    const result = validate({
      DATABASE_URL: databaseUrl,
      PORT: '4100',
      REDIS_PORT: '6380',
      AUTH_REFRESH_WEB_TTL_DAYS: '14',
    });

    expect(result).toEqual(expect.objectContaining({
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl,
      PORT: 4100,
      REDIS_PORT: 6380,
      AUTH_REFRESH_WEB_TTL_DAYS: 14,
      AUTH_REFRESH_MOBILE_TTL_DAYS: 30,
      PUSH_ENABLED: false,
    }));
  });

  it.each([
    ['false', false],
    ['true', true],
    [false, false],
    [true, true],
  ])('正确解析 PUSH_ENABLED=%p', (value, expected) => {
    expect(validate({ DATABASE_URL: databaseUrl, PUSH_ENABLED: value }).PUSH_ENABLED).toBe(expected);
  });

  it('拒绝模糊布尔值、未知环境和小于一天的刷新周期', () => {
    expect(() => validate({ DATABASE_URL: databaseUrl, PUSH_ENABLED: 'yes' })).toThrow();
    expect(() => validate({ DATABASE_URL: databaseUrl, NODE_ENV: 'staging' })).toThrow();
    expect(() => validate({
      DATABASE_URL: databaseUrl,
      AUTH_REFRESH_WEB_TTL_DAYS: '0',
    })).toThrow();
  });

  it.each([
    undefined,
    '',
    'dev-access-secret',
    'change-me-please-use-another-secret',
    'too-short',
  ])('生产环境拒绝默认或过短 JWT 密钥：%p', (secret) => {
    expect(() => validate({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: secret,
    })).toThrow('生产环境 JWT_ACCESS_SECRET');
  });

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
    expect(validate({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'production-random-secret-at-least-24-chars',
      PUSH_ENABLED: 'false',
    })).toEqual(expect.objectContaining({
      NODE_ENV: 'production',
      PUSH_ENABLED: false,
    }));

    expect(validate({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'production-random-secret-at-least-24-chars',
      PUSH_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'project-1',
      GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase.json',
    }).PUSH_ENABLED).toBe(true);
  });
});
