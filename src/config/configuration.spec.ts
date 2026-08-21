import configuration from './configuration';

describe('configuration', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('提供本地开发所需的稳定默认值', () => {
    expect(configuration()).toEqual(expect.objectContaining({
      port: 3000,
      database: {
        url: 'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyousite?schema=public',
      },
      redis: { host: '127.0.0.1', port: 6379 },
      jwt: {
        accessSecret: 'dev-access-secret-change-me',
        accessExpiresIn: '15m',
        refreshWebTtlDays: 7,
        refreshMobileTtlDays: 30,
      },
      argon2: { timeCost: 3, memoryCost: 65_536 },
      upload: { ratePerHour: 60, completedOrphanCleanupEnabled: false },
      directMessages: { sendRatePerMinute: 30, requestRatePerDay: 10 },
      push: {
        enabled: false,
        firebaseProjectId: '',
        credentialsPath: '',
        ttlSeconds: 86_400,
      },
      mobileCompatibility: {
        android: {
          minimumSupportedBuild: undefined,
          recommendedBuild: undefined,
          updateUrl: undefined,
        },
        ios: {
          minimumSupportedBuild: undefined,
          recommendedBuild: undefined,
          updateUrl: undefined,
        },
      },
    }));
  });

  it('解析数字、布尔值、可选路径和自定义配置', () => {
    Object.assign(process['env'], {
      PORT: '4100',
      REDIS_PORT: '6380',
      AUTH_REFRESH_WEB_TTL_DAYS: '14',
      AUTH_REFRESH_MOBILE_TTL_DAYS: '60',
      ARGON2_TIME_COST: '4',
      ARGON2_MEMORY_COST: '131072',
      UPLOAD_RATE_PER_HOUR: '80',
      MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED: 'true',
      DIRECT_MESSAGE_RATE_PER_MINUTE: '45',
      DIRECT_MESSAGE_REQUEST_RATE_PER_DAY: '12',
      SES_SMTP_PORT: '587',
      ENABLE_API_DOCS: 'false',
      PUSH_ENABLED: 'true',
      MOBILE_PUSH_TTL_SECONDS: '172800',
      MOBILE_ANDROID_MIN_SUPPORTED_BUILD: '120',
      MOBILE_ANDROID_RECOMMENDED_BUILD: '135',
      MOBILE_ANDROID_UPDATE_URL: 'https://play.google.com/store/apps/details?id=site.wenyou',
      MOBILE_IOS_MIN_SUPPORTED_BUILD: '80',
      MOBILE_IOS_RECOMMENDED_BUILD: '90',
      MOBILE_IOS_UPDATE_URL: 'https://apps.apple.com/app/id123456789',
      BUILD_SHA: 'abcdef',
      LOG_FILE_DIR: '/tmp/wenyou-logs',
    });

    const result = configuration();

    expect(result.port).toBe(4100);
    expect(result.redis.port).toBe(6380);
    expect(result.jwt).toEqual(expect.objectContaining({
      refreshWebTtlDays: 14,
      refreshMobileTtlDays: 60,
    }));
    expect(result.argon2).toEqual({ timeCost: 4, memoryCost: 131_072 });
    expect(result.upload.ratePerHour).toBe(80);
    expect(result.upload.completedOrphanCleanupEnabled).toBe(true);
    expect(result.directMessages).toEqual({ sendRatePerMinute: 45, requestRatePerDay: 12 });
    expect(result.ses.port).toBe(587);
    expect(result.app).toEqual(expect.objectContaining({ apiDocsEnabled: false, buildSha: 'abcdef' }));
    expect(result.push.enabled).toBe(true);
    expect(result.push.ttlSeconds).toBe(172_800);
    expect(result.mobileCompatibility).toEqual({
      android: {
        minimumSupportedBuild: 120,
        recommendedBuild: 135,
        updateUrl: 'https://play.google.com/store/apps/details?id=site.wenyou',
      },
      ios: {
        minimumSupportedBuild: 80,
        recommendedBuild: 90,
        updateUrl: 'https://apps.apple.com/app/id123456789',
      },
    });
    expect(result.log.fileDir).toBe('/tmp/wenyou-logs');
  });

  it('清理 CORS_ORIGINS 空白项并优先于 APP_URL', () => {
    process['env'].APP_URL = 'https://api.example.com';
    process['env'].CORS_ORIGINS = ' https://web.example.com, ,https://admin.example.com ';

    expect(configuration().app.corsOrigins).toEqual([
      'https://web.example.com',
      'https://admin.example.com',
    ]);

    delete process['env'].CORS_ORIGINS;
    expect(configuration().app.corsOrigins).toEqual(['https://api.example.com']);
  });

  it('空字符串可选配置归一为 undefined', () => {
    process['env'].BUILD_SHA = '';
    process['env'].LOG_FILE_DIR = '';

    expect(configuration()).toEqual(expect.objectContaining({
      app: expect.objectContaining({ buildSha: undefined }),
      log: expect.objectContaining({ fileDir: undefined }),
    }));
  });
});
