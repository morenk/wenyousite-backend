import { Controller, Post, Body, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { AuthRead } from './decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 认证控制器：注册、登录、Token 刷新 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: '注册新账号' })
  @ApiResponse({ status: 201, type: AuthResponseDto, description: '注册成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 409, description: '邮箱或用户名已被占用' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邮箱 + 密码登录' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '登录成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新访问令牌' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '刷新成功，返回新的双 Token' })
  @ApiResponse({ status: 401, description: '刷新令牌无效' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '验证邮箱' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiOperation({ summary: '重发验证邮件' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Post('change-password')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改密码' })
  async changePassword(
    @Req() req: FastifyRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    const user = req['user'] as { id: string };
    return this.authService.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiOperation({ summary: '忘记密码 — 发送重置邮件' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '重置密码' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('logout')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出，使所有已签发 token 立即失效' })
  async logout(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.authService.logout(user.id);
  }
}
