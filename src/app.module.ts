import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { validate } from './config/env.validation';

/** 根模块：注册所有特性模块和全局功能 */
@Module({
  imports: [
    // 环境变量配置：全局可用，从 .env 和 .env.local 加载，启动时校验
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env.local', '.env'],
    }),
    // Pino 结构化日志：开发环境使用 pino-pretty 彩色输出，生产环境输出 JSON
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
      },
    }),
    // 基础设施模块
    PrismaModule,   // 数据库连接
    HealthModule,   // 健康检查
    CommonModule,   // 公共组件
    // 业务模块
    AuthModule,     // 认证（注册/登录/JWT）
    UsersModule,    // 用户资料
  ],
})
export class AppModule {}
