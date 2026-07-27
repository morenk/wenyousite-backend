export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyouzhan?schema=public',
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  argon2: {
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '3', 10),
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '65536', 10),
  },

  cos: {
    endpoint: process.env.COS_ENDPOINT ?? '',
    region: process.env.COS_REGION ?? 'ap-hongkong',
    bucket: process.env.COS_BUCKET ?? '',
    accessKeyId: process.env.COS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.COS_SECRET_ACCESS_KEY ?? '',
  },

  ses: {
    host: process.env.SES_SMTP_HOST ?? '',
    port: parseInt(process.env.SES_SMTP_PORT ?? '465', 10),
    user: process.env.SES_SMTP_USER ?? '',
    pass: process.env.SES_SMTP_PASS ?? '',
    from: process.env.SES_FROM_ADDRESS ?? 'noreply@wenyouzhan.com',
  },

  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },

  app: {
    url: process.env.APP_URL ?? 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },
});
