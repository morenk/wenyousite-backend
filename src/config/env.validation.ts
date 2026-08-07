import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, validateSync } from 'class-validator';

/** 环境变量校验器：应用启动时验证必要的环境变量 */
enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  // 数据库连接串，生产环境必须设置
  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  REDIS_HOST: string = '127.0.0.1';

  @IsNumber()
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  JWT_ACCESS_SECRET: string = 'dev-access-secret';

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

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
  BUILD_SHA: string = '';

  @IsBoolean()
  @IsOptional()
  PUSH_ENABLED: boolean = false;

  @IsString()
  @IsOptional()
  FIREBASE_PROJECT_ID: string = '';

  @IsString()
  @IsOptional()
  GOOGLE_APPLICATION_CREDENTIALS: string = '';

  @IsString()
  @IsOptional()
  COS_ENDPOINT: string = 'https://cn-nb1.rains3.com';

  @IsString()
  @IsOptional()
  COS_REGION: string = 'auto';

  @IsString()
  @IsOptional()
  COS_BUCKET: string = 'wenyou';

  @IsString()
  @IsOptional()
  COS_ACCESS_KEY_ID: string = '';

  @IsString()
  @IsOptional()
  COS_SECRET_ACCESS_KEY: string = '';

  @IsNumber()
  @IsOptional()
  UPLOAD_RATE_PER_HOUR: number = 60;

  @IsNumber()
  @IsOptional()
  DIRECT_MESSAGE_RATE_PER_MINUTE: number = 30;

  @IsNumber()
  @IsOptional()
  DIRECT_MESSAGE_REQUEST_RATE_PER_DAY: number = 10;

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  LOG_FILE_DIR: string = '';

  @IsString()
  @IsOptional()
  ENABLE_API_DOCS: string = 'true';
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
  if (validatedConfig.NODE_ENV === Environment.Production) {
    if (
      !validatedConfig.JWT_ACCESS_SECRET ||
      validatedConfig.JWT_ACCESS_SECRET.startsWith('dev-') ||
      validatedConfig.JWT_ACCESS_SECRET.startsWith('change-me') ||
      validatedConfig.JWT_ACCESS_SECRET.length < 24
    ) {
      throw new Error('生产环境 JWT_ACCESS_SECRET 必须是至少 24 字符的非默认随机值');
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
