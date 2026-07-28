import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangeEmailRequestDto, ChangeEmailVerifyDto } from './dto/change-email.dto';
import { AuthRead, Auth } from './decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
};

/** 认证控制器：注册、登录、Token 刷新、会话管理 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register/request-code')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiOperation({ summary: '注册第一步：请求邮箱验证码' })
  async requestCode(@Body() dto: RequestCodeDto) {
    return this.authService.requestCode(dto.email);
  }

  @Post('register/verify-and-complete')
  @Public()
  @ApiOperation({ summary: '注册第二步：验证邮箱 + 设置用户名密码，一步完成注册' })
  @ApiResponse({ status: 201, type: AuthResponseDto, description: '注册成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 409, description: '用户名已被占用' })
  async verifyAndComplete(@Body() dto: VerifyAndCompleteDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const deviceInfo = req.headers['user-agent']?.slice(0, 512) ?? undefined;
    const platform = (req.headers['x-client-platform'] as string) || 'web';
    const result = await this.authService.verifyAndComplete(dto, deviceInfo, platform);
    const ttl = platform === 'mobile' ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
    res.setCookie('refreshToken', result.refreshToken, { ...COOKIE_BASE, maxAge: ttl });
    return result;
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邮箱 + 密码登录' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '登录成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误' })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const deviceInfo = req.headers['user-agent']?.slice(0, 512) ?? undefined;
    const platform = (req.headers['x-client-platform'] as string) || 'web';
    const result = await this.authService.login(dto, deviceInfo, platform);
    const ttl = platform === 'mobile' ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
    res.setCookie('refreshToken', result.refreshToken, { ...COOKIE_BASE, maxAge: ttl });
    return result;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新访问令牌（Cookie 优先）' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '刷新成功，返回新的双 Token' })
  @ApiResponse({ status: 401, description: '刷新令牌无效' })
  async refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.refreshToken ?? dto.refreshToken;
    if (!token) throw new UnauthorizedException('缺少刷新令牌');
    const result = await this.authService.refresh(token);
    // 沿用请求中的 platform cookie TTL（无法从结果反向推算，取 web 默认值，mobile 端轮转时会刷新为 30 天）
    const platform = (req.headers['x-client-platform'] as string) || 'web';
    const ttl = platform === 'mobile' ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60;
    res.setCookie('refreshToken', result.refreshToken, { ...COOKIE_BASE, maxAge: ttl });
    return result;
  }

  @Post('verify-email')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '验证当前登录用户的邮箱' })
  async verifyEmail(@Req() req: FastifyRequest, @Body() dto: VerifyEmailDto) {
    const user = req['user'] as { id: string };
    return this.authService.verifyEmail(user.id, dto.token);
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
    return this.authService.resetPassword(dto.email, dto.token, dto.newPassword);
  }

  @Post('change-email/request-code')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '更换邮箱第一步：向新邮箱发送验证码' })
  async requestChangeEmailCode(@Req() req: FastifyRequest, @Body() dto: ChangeEmailRequestDto) {
    const user = req['user'] as { id: string };
    return this.authService.requestChangeEmailCode(user.id, dto.newEmail);
  }

  @Post('change-email/verify')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '更换邮箱第二步：验证码确认，更新邮箱' })
  async verifyChangeEmail(@Req() req: FastifyRequest, @Body() dto: ChangeEmailVerifyDto) {
    const user = req['user'] as { id: string };
    return this.authService.verifyChangeEmail(user.id, dto.newEmail, dto.code);
  }

  @Post('logout')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出，撤销指定设备的 refresh token（Cookie 优先）' })
  async logout(@Req() req: FastifyRequest, @Body() dto: LogoutDto, @Res({ passthrough: true }) res: FastifyReply) {
    const user = req['user'] as { id: string };
    const token = req.cookies?.refreshToken ?? dto.refreshToken;
    if (token) {
      await this.authService.logout(user.id, token);
    }
    res.clearCookie('refreshToken', COOKIE_BASE);
    return { message: '已登出' };
  }

  @Get('sessions')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户所有活跃会话列表' })
  async listSessions(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const token = req.cookies?.refreshToken ?? '';
    return this.authService.listSessions(user.id, token);
  }

  @Delete('sessions/:id')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤销指定会话（远程登出设备）' })
  async revokeSession(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    return this.authService.revokeSession(user.id, id);
  }
}