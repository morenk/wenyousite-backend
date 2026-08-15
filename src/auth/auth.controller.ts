import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiOkResponse, ApiUnauthorizedResponse, ApiConflictResponse, ApiBadRequestResponse, ApiHeader } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto, RegisterCodeResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangeEmailRequestDto, ChangeEmailVerifyDto } from './dto/change-email.dto';
import { RevokeSessionResponseDto, SessionResponseDto } from './dto/session-response.dto';
import { AuthRead, Auth } from './decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CLIENT_PLATFORMS, normalizeClientPlatform, refreshTtlSeconds } from './client-platform';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { unauthorized } from '../common/exceptions/business.exception';
import { ConfigService } from '@nestjs/config';

function authResultForClient<T extends { refreshToken: string }>(
  result: T,
  platform: 'web' | 'mobile',
  res: FastifyReply,
  cookieBase: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string },
  maxAge: number,
) {
  if (platform === 'mobile') return result;

  res.setCookie('refreshToken', result.refreshToken, {
    ...cookieBase,
    maxAge,
  });
  const webResult = { ...result } as Partial<T>;
  delete webResult.refreshToken;
  return webResult as Omit<T, 'refreshToken'>;
}

/** 认证控制器：注册、登录、Token 刷新、双端登录终端管理 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  private get cookieBase() {
    return {
      httpOnly: true as const,
      secure: this.config.get<string>('app.nodeEnv') === 'production',
      sameSite: 'lax' as const,
      path: '/api/v1/auth',
    };
  }

  private refreshMaxAge(platform: 'web' | 'mobile') {
    return refreshTtlSeconds(
      platform,
      this.config.get<number>('jwt.refreshWebTtlDays') ?? 7,
      this.config.get<number>('jwt.refreshMobileTtlDays') ?? 30,
    );
  }

  @Post('register/request-code')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiOperation({ summary: '注册第一步：请求邮箱验证码（限流 1次/分钟）' })
  @ApiOkResponse({ type: RegisterCodeResponseDto, description: '验证码已发送 { emailSent, codeExpiresIn: 900 }' })
  @ApiResponse({ status: 429, description: '请求频繁，请稍后重试（1 分钟 1 次）' })
  async requestCode(@Body() dto: RequestCodeDto) {
    return this.authService.requestCode(dto.email);
  }

  @Post('register/verify-and-complete')
  @Public()
  @ApiHeader({ name: 'X-Client-Platform', required: false, enum: CLIENT_PLATFORMS, description: '客户端类型：web（PC/手机浏览器）或 mobile（原生移动端）' })
  @ApiOperation({ summary: '注册第二步：验证邮箱 + 设置用户名密码，完成后立即建立账号会话' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '注册成功；Web 通过 httpOnly Cookie 接收 refresh token，移动客户端从响应体接收' })
  @ApiResponse({ status: 400, description: '验证码错误或过期' })
  @ApiResponse({ status: 409, description: '用户名已被占用' })
  async verifyAndComplete(@Body() dto: VerifyAndCompleteDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const deviceInfo = req.headers['user-agent']?.slice(0, 512) ?? undefined;
    const platform = normalizeClientPlatform(req.headers['x-client-platform']);
    const result = await this.authService.verifyAndComplete(dto, deviceInfo, platform);
    return authResultForClient(result, platform, res, this.cookieBase, this.refreshMaxAge(platform));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'X-Client-Platform', required: false, enum: CLIENT_PLATFORMS, description: '客户端类型：web（PC/手机浏览器）或 mobile（原生移动端）' })
  @ApiOperation({ summary: '邮箱或用户名 + 密码登录。5 次失败锁定 15 分钟' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '登录成功；Web 通过 httpOnly Cookie 接收 refresh token，移动客户端从响应体接收' })
  @ApiResponse({ status: 401, description: '账号或密码错误 或 账号被锁定' })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const deviceInfo = req.headers['user-agent']?.slice(0, 512) ?? undefined;
    const platform = normalizeClientPlatform(req.headers['x-client-platform']);
    const result = await this.authService.login(dto, deviceInfo, platform);
    return authResultForClient(result, platform, res, this.cookieBase, this.refreshMaxAge(platform));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用 refreshToken 轮转换取新双 Token（Cookie 优先，含盗用检测）' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '刷新成功；平台沿用服务端会话记录，不信任请求头' })
  @ApiResponse({ status: 401, description: 'refreshToken 无效/过期/已被盗用（确认重放时对应登录终端退出）' })
  async refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.refreshToken ?? dto.refreshToken;
    if (!token) throw unauthorized('缺少刷新令牌', ErrorCode.TOKEN_INVALID);
    const { platform, ...result } = await this.authService.refresh(token);
    return authResultForClient(result, platform, res, this.cookieBase, this.refreshMaxAge(platform));
  }

  @Post('change-password')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改密码（需旧密码），成功后退出全部登录终端' })
  @ApiOkResponse({ type: MessageResponseDto, description: '密码修改成功' })
  @ApiUnauthorizedResponse({ description: '未登录或旧密码错误' })
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
  @ApiOperation({ summary: '忘记密码 — 发送重置邮件（限流 1次/分钟）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '密码重置邮件已发送' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '用邮箱 + 验证码重置密码，成功后吊销全部 refresh token' })
  @ApiOkResponse({ type: MessageResponseDto, description: '密码重置成功' })
  @ApiBadRequestResponse({ description: '验证码错误 或 密码格式不符合要求' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.token, dto.newPassword);
  }

  @Post('change-email/request-code')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '更换邮箱第一步：向新邮箱发送验证码（限流 1次/分钟）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '验证码已发送' })
  @ApiUnauthorizedResponse({ description: '未登录' })
  @ApiConflictResponse({ description: '新邮箱已被占用' })
  async requestChangeEmailCode(@Req() req: FastifyRequest, @Body() dto: ChangeEmailRequestDto) {
    const user = req['user'] as { id: string };
    return this.authService.requestChangeEmailCode(user.id, dto.newEmail, dto.oldPassword);
  }

  @Post('change-email/verify')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '更换邮箱第二步：验证码确认并更新邮箱' })
  @ApiOkResponse({ type: MessageResponseDto, description: '邮箱更换成功' })
  @ApiUnauthorizedResponse({ description: '未登录' })
  @ApiBadRequestResponse({ description: '验证码错误或过期' })
  async verifyChangeEmail(@Req() req: FastifyRequest, @Body() dto: ChangeEmailVerifyDto) {
    const user = req['user'] as { id: string };
    return this.authService.verifyChangeEmail(user.id, dto.newEmail, dto.code);
  }

  @Post('logout')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出：按 access token 的稳定终端 ID 撤销当前终端，旧客户端回退到 refresh token' })
  @ApiOkResponse({ type: MessageResponseDto, description: '当前登录终端已撤销，客户端 Cookie 被清除' })
  async logout(@Req() req: FastifyRequest, @Body() dto: LogoutDto, @Res({ passthrough: true }) res: FastifyReply) {
    const user = req['user'] as { id: string; sessionId?: string };
    const token = req.cookies?.refreshToken ?? dto.refreshToken;
    res.clearCookie('refreshToken', this.cookieBase);
    if (user.sessionId) {
      await this.authService.revokeSession(user.id, user.sessionId);
    } else if (token) {
      await this.authService.logout(user.id, token);
    } else {
      throw unauthorized('登录终端不存在或已失效', ErrorCode.SESSION_NOT_FOUND);
    }
    return { message: '已登出' };
  }

  @Get('sessions')
  @AuthRead()
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: '获取当前用户的 Web / 移动客户端活跃登录终端（限流 60 次/分钟）' })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true, description: '最多返回 Web 与移动客户端各一个活跃登录终端' })
  @ApiResponse({ status: 429, description: '请求频繁，请稍后重试（登录终端列表独立限流 60 次/分钟）' })
  async listSessions(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string; sessionId?: string };
    const token = req.cookies?.refreshToken ?? '';
    return this.authService.listSessions(user.id, user.sessionId, token);
  }

  @Delete('sessions/:id')
  @AuthRead()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: '退出指定登录终端（限流 60 次/分钟）' })
  @ApiOkResponse({ type: RevokeSessionResponseDto, description: '指定登录终端已退出' })
  @ApiBadRequestResponse({ description: '登录终端不存在或已失效' })
  @ApiResponse({ status: 429, description: '请求频繁，请稍后重试（退出登录终端独立限流 60 次/分钟）' })
  async revokeSession(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    return this.authService.revokeSession(user.id, id);
  }
}
