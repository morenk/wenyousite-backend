import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/** 认证模块：注册 JWT 策略、Passport 守卫，提供注册/登录/刷新 API */
@Module({
  imports: [
    // Passport 模块，默认使用 JWT 策略
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // 异步配置 JWT 模块，从 ConfigService 读取密钥
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
        signOptions: { expiresIn: '15m' as const },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
