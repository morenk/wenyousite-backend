import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

/** 环境变量校验器：应用启动时验证必要的环境变量 */
export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  HOST: string = '0.0.0.0';

  // 数据库连接串，生产环境必须设置
  @IsString()
  DATABASE_URL: string = 'postgresql://wenyou:wenyou@127.0.0.1:5432/wenyousite?schema=public';

  // Prisma CLI / migration 专用连接；运行进程不得读取此凭据。
  @IsString()
  @IsOptional()
  DIRECT_DATABASE_URL: string = '';

  @IsString()
  @IsOptional()
  REDIS_HOST: string = '127.0.0.1';

  @IsNumber()
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  @IsString()
  @IsOptional()
  REDIS_USERNAME: string = '';

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string = '';

  // 全局请求限流；正式环境默认每秒 10 个请求，隔离压测实例可单独提高。
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(10_000)
  GLOBAL_RATE_LIMIT_PER_SECOND: number = 10;

  @IsString()
  @IsOptional()
  JWT_ACCESS_SECRET: string = 'dev-access-secret-change-me';

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsNumber()
  @IsOptional()
  @Min(1)
  ARGON2_TIME_COST: number = 3;

  @IsNumber()
  @IsOptional()
  @Min(8_192)
  ARGON2_MEMORY_COST: number = 65_536;

  @IsNumber()
  @IsOptional()
  @Min(1)
  AUTH_REFRESH_WEB_TTL_DAYS: number = 7;

  @IsNumber()
  @IsOptional()
  @Min(1)
  AUTH_REFRESH_MOBILE_TTL_DAYS: number = 30;

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = '';

  @IsString()
  @IsOptional()
  APP_URL: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  WEB_APP_URL: string = 'http://localhost:3001';

  @IsString()
  @IsOptional()
  ADMIN_WEB_ENTRY_URL: string = '';

  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(120)
  ADMIN_SESSION_IDLE_MINUTES: number = 30;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(24)
  ADMIN_SESSION_ABSOLUTE_HOURS: number = 8;

  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(30)
  ADMIN_STEP_UP_MINUTES: number = 10;

  @IsString()
  @IsOptional()
  ADMIN_CHALLENGE_PEPPER: string = '';

  @IsString()
  @IsOptional()
  BUILD_SHA: string = '';

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  PUSH_ENABLED: boolean | 'true' | 'false' = false;

  @IsString()
  @IsOptional()
  FIREBASE_PROJECT_ID: string = '';

  @IsString()
  @IsOptional()
  GOOGLE_APPLICATION_CREDENTIALS: string = '';

  @IsNumber()
  @IsOptional()
  @Min(60)
  @Max(2_419_200)
  MOBILE_PUSH_TTL_SECONDS: number = 86_400;

  @IsString()
  @Matches(/^(?:|[1-9]\d*)$/)
  MOBILE_ANDROID_MIN_SUPPORTED_BUILD: string = '';

  @IsString()
  @Matches(/^(?:|[1-9]\d*)$/)
  MOBILE_ANDROID_RECOMMENDED_BUILD: string = '';

  @IsString()
  @ValidateIf((value: EnvironmentVariables) => value.MOBILE_ANDROID_UPDATE_URL !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  MOBILE_ANDROID_UPDATE_URL: string = '';

  @IsString()
  @Matches(/^(?:|[1-9]\d*)$/)
  MOBILE_IOS_MIN_SUPPORTED_BUILD: string = '';

  @IsString()
  @Matches(/^(?:|[1-9]\d*)$/)
  MOBILE_IOS_RECOMMENDED_BUILD: string = '';

  @IsString()
  @ValidateIf((value: EnvironmentVariables) => value.MOBILE_IOS_UPDATE_URL !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  MOBILE_IOS_UPDATE_URL: string = '';

  @IsString()
  @IsOptional()
  COS_ENDPOINT: string = '';

  @IsString()
  @IsOptional()
  COS_REGION: string = 'ap-hongkong';

  @IsString()
  @IsOptional()
  COS_BUCKET: string = '';

  @IsString()
  @IsOptional()
  COS_ACCESS_KEY_ID: string = '';

  @IsString()
  @IsOptional()
  COS_SECRET_ACCESS_KEY: string = '';

  @IsNumber()
  @IsOptional()
  @Min(1)
  UPLOAD_RATE_PER_HOUR: number = 60;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED: boolean | 'true' | 'false' = false;

  @IsNumber()
  @IsOptional()
  @Min(1)
  DIRECT_MESSAGE_RATE_PER_MINUTE: number = 30;

  @IsNumber()
  @IsOptional()
  @Min(1)
  DIRECT_MESSAGE_REQUEST_RATE_PER_DAY: number = 10;

  @IsString()
  @IsOptional()
  SES_SMTP_HOST: string = '';

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(65_535)
  SES_SMTP_PORT: number = 465;

  @IsString()
  @IsOptional()
  SES_SMTP_USER: string = '';

  @IsString()
  @IsOptional()
  SES_SMTP_PASS: string = '';

  @IsString()
  @IsOptional()
  SES_FROM_ADDRESS: string = 'noreply@mail.wenyou.site';

  @IsString()
  @IsOptional()
  SENTRY_DSN: string = '';

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  LOG_FILE_DIR: string = '';

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  ENABLE_API_DOCS: boolean | 'true' | 'false' = true;
}

/** 校验函数：在 ConfigModule.forRoot 中调用，启动时验证环境变量完整性 */
export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  for (const [platform, minimum, recommended, updateUrl] of [
    [
      'Android',
      validatedConfig.MOBILE_ANDROID_MIN_SUPPORTED_BUILD,
      validatedConfig.MOBILE_ANDROID_RECOMMENDED_BUILD,
      validatedConfig.MOBILE_ANDROID_UPDATE_URL,
    ],
    [
      'iOS',
      validatedConfig.MOBILE_IOS_MIN_SUPPORTED_BUILD,
      validatedConfig.MOBILE_IOS_RECOMMENDED_BUILD,
      validatedConfig.MOBILE_IOS_UPDATE_URL,
    ],
  ] as const) {
    const minimumBuild = minimum ? Number(minimum) : undefined;
    const recommendedBuild = recommended ? Number(recommended) : undefined;
    if (
      minimumBuild !== undefined &&
      recommendedBuild !== undefined &&
      recommendedBuild < minimumBuild
    ) {
      throw new Error(`${platform} 推荐构建号不能低于最低支持构建号`);
    }
    if ((minimumBuild !== undefined || recommendedBuild !== undefined) && !updateUrl) {
      throw new Error(`${platform} 配置构建号策略时必须提供 HTTPS 更新地址`);
    }
  }
  if (validatedConfig.NODE_ENV === Environment.Production) {
    const configuredDatabaseUrl = config.DATABASE_URL;
    if (typeof configuredDatabaseUrl !== 'string' || !configuredDatabaseUrl.trim()) {
      throw new Error('生产环境 DATABASE_URL 必须显式配置');
    }
    let databaseUrl: URL;
    try {
      databaseUrl = new URL(validatedConfig.DATABASE_URL);
    } catch {
      throw new Error('生产环境 DATABASE_URL 必须是合法 PostgreSQL URL');
    }
    if (
      !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
      !databaseUrl.username ||
      !databaseUrl.password
    ) {
      throw new Error('生产环境 DATABASE_URL 必须包含 PostgreSQL 运行角色和密码');
    }
    if (validatedConfig.HOST !== '127.0.0.1' && validatedConfig.HOST !== '::1') {
      throw new Error('生产环境 HOST 必须只监听 loopback');
    }
    const databasePort = databaseUrl.port || '5432';
    const isolatedLoadtest =
      validatedConfig.PORT === 3100 &&
      databaseUrl.hostname === '127.0.0.1' &&
      databasePort === '55432' &&
      decodeURIComponent(databaseUrl.username) === 'wenyou_loadtest' &&
      validatedConfig.REDIS_HOST === '127.0.0.1' &&
      validatedConfig.REDIS_PORT === 56379;
    if (!isolatedLoadtest) {
      if (
        decodeURIComponent(databaseUrl.username) !== 'wenyousite_app' ||
        decodeURIComponent(databaseUrl.password) === 'wenyou'
      ) {
        throw new Error('生产环境 DATABASE_URL 必须使用非默认 wenyousite_app 运行凭据');
      }
      if (!validatedConfig.REDIS_USERNAME || !validatedConfig.REDIS_PASSWORD) {
        throw new Error('生产环境 Redis 必须配置 ACL 用户名和密码');
      }
      if (
        validatedConfig.REDIS_USERNAME !== 'wenyousite_app' ||
        validatedConfig.REDIS_PASSWORD.length < 24 ||
        validatedConfig.REDIS_PASSWORD.startsWith('change-me')
      ) {
        throw new Error('生产环境 Redis 必须使用至少 24 字符的 wenyousite_app ACL 凭据');
      }
    }
    if (
      !validatedConfig.JWT_ACCESS_SECRET ||
      validatedConfig.JWT_ACCESS_SECRET.startsWith('dev-') ||
      validatedConfig.JWT_ACCESS_SECRET.startsWith('change-me') ||
      validatedConfig.JWT_ACCESS_SECRET.length < 24
    ) {
      throw new Error('生产环境 JWT_ACCESS_SECRET 必须是至少 24 字符的非默认随机值');
    }
    if (
      validatedConfig.ADMIN_CHALLENGE_PEPPER &&
      (validatedConfig.ADMIN_CHALLENGE_PEPPER.startsWith('dev-') ||
        validatedConfig.ADMIN_CHALLENGE_PEPPER.startsWith('change-me') ||
        validatedConfig.ADMIN_CHALLENGE_PEPPER.length < 32)
    ) {
      throw new Error('生产环境 ADMIN_CHALLENGE_PEPPER 必须是至少 32 字符的独立随机值');
    }
    if (
      validatedConfig.PUSH_ENABLED &&
      (!validatedConfig.FIREBASE_PROJECT_ID || !validatedConfig.GOOGLE_APPLICATION_CREDENTIALS)
    ) {
      throw new Error('启用推送时必须配置 FIREBASE_PROJECT_ID 和 GOOGLE_APPLICATION_CREDENTIALS');
    }
  }
  return validatedConfig;
}
