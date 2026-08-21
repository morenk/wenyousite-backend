function optionalPositiveInteger(value: string | undefined): number | undefined {
  return value ? Number.parseInt(value, 10) : undefined;
}

/** 应用配置：从环境变量读取配置，提供类型安全访问 */
export default () => ({
  // 服务端口
  port: parseInt(process.env.PORT ?? '3000', 10),

  // PostgreSQL 数据库连接串
  database: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyousite?schema=public',
  },

  // Redis 连接配置（用于缓存、队列、会话）
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  // JWT 双 Token 配置
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshWebTtlDays: parseInt(process.env.AUTH_REFRESH_WEB_TTL_DAYS ?? '7', 10),
    refreshMobileTtlDays: parseInt(process.env.AUTH_REFRESH_MOBILE_TTL_DAYS ?? '30', 10),
  },

  // Argon2 密码哈希参数
  argon2: {
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '3', 10),
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '65536', 10),
  },

  // 腾讯 COS 对象存储（客户端直传文件）
  cos: {
    endpoint: process.env.COS_ENDPOINT ?? '',
    region: process.env.COS_REGION ?? 'ap-hongkong',
    bucket: process.env.COS_BUCKET ?? '',
    accessKeyId: process.env.COS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.COS_SECRET_ACCESS_KEY ?? '',
  },

  // 图片上传：每用户小时配额（防刷爆存储）
  upload: {
    ratePerHour: parseInt(process.env.UPLOAD_RATE_PER_HOUR ?? '60', 10),
    completedOrphanCleanupEnabled: process.env.MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED === 'true',
  },

  // 私聊防滥用：总发送频率与陌生请求每日配额
  directMessages: {
    sendRatePerMinute: parseInt(process.env.DIRECT_MESSAGE_RATE_PER_MINUTE ?? '30', 10),
    requestRatePerDay: parseInt(process.env.DIRECT_MESSAGE_REQUEST_RATE_PER_DAY ?? '10', 10),
  },

  // 阿里云邮件推送 (DirectMail) SMTP（注册验证、找回密码）
  ses: {
    host: process.env.SES_SMTP_HOST ?? '',
    port: parseInt(process.env.SES_SMTP_PORT ?? '465', 10),
    user: process.env.SES_SMTP_USER ?? '',
    pass: process.env.SES_SMTP_PASS ?? '',
    from: process.env.SES_FROM_ADDRESS ?? 'noreply@mail.wenyou.site',
  },

  // Sentry 错误监控
  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },

  // 应用基础信息
  app: {
    url: process.env.APP_URL ?? 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    apiDocsEnabled: process.env.ENABLE_API_DOCS !== 'false',
    buildSha: process.env.BUILD_SHA || undefined,
    corsOrigins: (process.env.CORS_ORIGINS || process.env.APP_URL || 'http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    webUrl: process.env.WEB_APP_URL ?? 'http://localhost:3001',
    adminWebEntryUrl: process.env.ADMIN_WEB_ENTRY_URL ?? '',
  },

  admin: {
    idleMinutes: parseInt(process.env.ADMIN_SESSION_IDLE_MINUTES ?? '30', 10),
    absoluteHours: parseInt(process.env.ADMIN_SESSION_ABSOLUTE_HOURS ?? '8', 10),
    stepUpMinutes: parseInt(process.env.ADMIN_STEP_UP_MINUTES ?? '10', 10),
    challengePepper:
      process.env.ADMIN_CHALLENGE_PEPPER ??
      (process.env.NODE_ENV === 'production'
        ? `${process.env.JWT_ACCESS_SECRET}:wenyou-admin-challenge-v1`
        : 'dev-admin-pepper-change-me'),
  },

  push: {
    enabled: process.env.PUSH_ENABLED === 'true',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '',
    ttlSeconds: parseInt(process.env.MOBILE_PUSH_TTL_SECONDS ?? '86400', 10),
  },

  mobileCompatibility: {
    android: {
      minimumSupportedBuild: optionalPositiveInteger(
        process.env.MOBILE_ANDROID_MIN_SUPPORTED_BUILD,
      ),
      recommendedBuild: optionalPositiveInteger(process.env.MOBILE_ANDROID_RECOMMENDED_BUILD),
      updateUrl: process.env.MOBILE_ANDROID_UPDATE_URL || undefined,
    },
    ios: {
      minimumSupportedBuild: optionalPositiveInteger(process.env.MOBILE_IOS_MIN_SUPPORTED_BUILD),
      recommendedBuild: optionalPositiveInteger(process.env.MOBILE_IOS_RECOMMENDED_BUILD),
      updateUrl: process.env.MOBILE_IOS_UPDATE_URL || undefined,
    },
  },

  // 日志：Pino 结构化日志配置
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    fileDir: process.env.LOG_FILE_DIR || undefined,
  },
});
