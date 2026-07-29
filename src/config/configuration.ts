/** 应用配置：从环境变量读取配置，提供类型安全访问 */
export default () => ({
  // 服务端口
  port: parseInt(process.env.PORT ?? '3000', 10),

  // PostgreSQL 数据库连接串
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyouzhan?schema=public',
  },

  // Redis 连接配置（用于缓存、队列、会话）
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  // JWT 双 Token 配置
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
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

  // 腾讯 SES 邮件服务（注册验证、找回密码）
  ses: {
    host: process.env.SES_SMTP_HOST ?? '',
    port: parseInt(process.env.SES_SMTP_PORT ?? '465', 10),
    user: process.env.SES_SMTP_USER ?? '',
    pass: process.env.SES_SMTP_PASS ?? '',
    from: process.env.SES_FROM_ADDRESS ?? 'noreply@wenyouzhan.com',
  },

  // Sentry 错误监控
  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },

  // 应用基础信息
  app: {
    url: process.env.APP_URL ?? 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },

  // 日志：Pino 结构化日志配置
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    fileDir: process.env.LOG_FILE_DIR || undefined,
  },
});
