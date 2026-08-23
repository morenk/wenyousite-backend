import { validate } from './env.validation';

/** 应用配置：从环境变量读取配置，提供类型安全访问 */
export default function configuration() {
  const env = validate(process.env);
  const optionalPositiveInteger = (value: string): number | undefined =>
    value ? Number.parseInt(value, 10) : undefined;

  return {
    // 服务端口
    port: env.PORT,

    // PostgreSQL 数据库连接串
    database: {
      url: env.DATABASE_URL,
    },

    // Redis 连接配置（用于缓存、队列、会话）
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      db: env.REDIS_DB,
    },

    throttling: {
      globalRatePerSecond: env.GLOBAL_RATE_LIMIT_PER_SECOND,
    },

    // JWT 双 Token 配置
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshWebTtlDays: env.AUTH_REFRESH_WEB_TTL_DAYS,
      refreshMobileTtlDays: env.AUTH_REFRESH_MOBILE_TTL_DAYS,
    },

    // Argon2 密码哈希参数
    argon2: {
      timeCost: env.ARGON2_TIME_COST,
      memoryCost: env.ARGON2_MEMORY_COST,
    },

    // 腾讯 COS 对象存储（客户端直传文件）
    cos: {
      endpoint: env.COS_ENDPOINT,
      region: env.COS_REGION,
      bucket: env.COS_BUCKET,
      accessKeyId: env.COS_ACCESS_KEY_ID,
      secretAccessKey: env.COS_SECRET_ACCESS_KEY,
    },

    // 图片上传：每用户小时配额（防刷爆存储）
    upload: {
      ratePerHour: env.UPLOAD_RATE_PER_HOUR,
      completedOrphanCleanupEnabled: env.MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED,
    },

    // 私聊防滥用：总发送频率与陌生请求每日配额
    directMessages: {
      sendRatePerMinute: env.DIRECT_MESSAGE_RATE_PER_MINUTE,
      requestRatePerDay: env.DIRECT_MESSAGE_REQUEST_RATE_PER_DAY,
    },

    // 阿里云邮件推送 (DirectMail) SMTP（注册验证、找回密码）
    ses: {
      host: env.SES_SMTP_HOST,
      port: env.SES_SMTP_PORT,
      user: env.SES_SMTP_USER,
      pass: env.SES_SMTP_PASS,
      from: env.SES_FROM_ADDRESS,
    },

    // Sentry 错误监控
    sentry: {
      dsn: env.SENTRY_DSN,
    },

    // 应用基础信息
    app: {
      url: env.APP_URL,
      nodeEnv: env.NODE_ENV,
      apiDocsEnabled: env.ENABLE_API_DOCS,
      buildSha: env.BUILD_SHA || undefined,
      corsOrigins: (env.CORS_ORIGINS || env.APP_URL || 'http://localhost:3001')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      webUrl: env.WEB_APP_URL,
      adminWebEntryUrl: env.ADMIN_WEB_ENTRY_URL,
    },

    admin: {
      idleMinutes: env.ADMIN_SESSION_IDLE_MINUTES,
      absoluteHours: env.ADMIN_SESSION_ABSOLUTE_HOURS,
      stepUpMinutes: env.ADMIN_STEP_UP_MINUTES,
      challengePepper:
        env.ADMIN_CHALLENGE_PEPPER ||
        (env.NODE_ENV === 'production'
          ? `${env.JWT_ACCESS_SECRET}:wenyou-admin-challenge-v1`
          : 'dev-admin-pepper-change-me'),
    },

    push: {
      enabled: env.PUSH_ENABLED,
      firebaseProjectId: env.FIREBASE_PROJECT_ID,
      credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS,
      ttlSeconds: env.MOBILE_PUSH_TTL_SECONDS,
    },

    mobileCompatibility: {
      android: {
        minimumSupportedBuild: optionalPositiveInteger(env.MOBILE_ANDROID_MIN_SUPPORTED_BUILD),
        recommendedBuild: optionalPositiveInteger(env.MOBILE_ANDROID_RECOMMENDED_BUILD),
        updateUrl: env.MOBILE_ANDROID_UPDATE_URL || undefined,
      },
      ios: {
        minimumSupportedBuild: optionalPositiveInteger(env.MOBILE_IOS_MIN_SUPPORTED_BUILD),
        recommendedBuild: optionalPositiveInteger(env.MOBILE_IOS_RECOMMENDED_BUILD),
        updateUrl: env.MOBILE_IOS_UPDATE_URL || undefined,
      },
    },

    // 日志：Pino 结构化日志配置
    log: {
      level: env.LOG_LEVEL,
      fileDir: env.LOG_FILE_DIR || undefined,
    },
  };
}

export type AppConfig = ReturnType<typeof configuration>;
