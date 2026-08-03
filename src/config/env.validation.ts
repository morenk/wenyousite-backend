import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

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
  JWT_REFRESH_SECRET: string = 'dev-refresh-secret';

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

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

  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  LOG_FILE_DIR: string = '';
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
  return validatedConfig;
}
