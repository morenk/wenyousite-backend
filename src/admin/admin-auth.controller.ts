import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuthService } from './admin-auth.service';
import { adminSessionCookieName } from './admin-auth.constants';
import { AdminChallengeVerifyDto, AdminLoginChallengeDto } from './dto/admin-auth.dto';
import { AdminAuth } from './admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import {
  AdminChallengeResponseDto,
  AdminSessionResponseDto,
  AdminStepUpResponseDto,
} from './dto/admin-station-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { Public } from '../auth/decorators/public.decorator';

function fingerprint(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

@ApiTags('Admin Auth')
@Controller('admin/auth')
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  private get production() {
    return this.config.get<string>('app.nodeEnv') === 'production';
  }

  private setSessionCookie(reply: FastifyReply, token: string, maxAge: number) {
    reply.setCookie(adminSessionCookieName(this.production), token, {
      httpOnly: true,
      secure: this.production,
      sameSite: 'strict',
      path: '/api/v1/admin',
      maxAge,
    });
  }

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: '管理员密码校验后发送邮箱二次验证码' })
  @ApiOkResponse({ type: AdminChallengeResponseDto })
  async challenge(@Body() dto: AdminLoginChallengeDto, @Req() request: FastifyRequest) {
    return this.auth.createLoginChallenge(dto, fingerprint(request));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: '验证管理员验证码并建立独立管理员 Cookie 会话' })
  @ApiOkResponse({ type: AdminSessionResponseDto })
  async verify(
    @Body() dto: AdminChallengeVerifyDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.verifyLoginChallenge(
      dto.challengeId,
      dto.code,
      fingerprint(request),
    );
    const maxAge = Math.max(
      0,
      Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000),
    );
    this.setSessionCookie(reply, result.rawToken, maxAge);
    const csrfToken = reply.generateCsrf();
    return { session: result.session, user: result.user, csrfToken };
  }

  @Get('session')
  @AdminAuth()
  @ApiOperation({ summary: '读取并续活当前管理员会话，同时轮发 CSRF token' })
  @ApiOkResponse({ type: AdminSessionResponseDto })
  async session(
    @CurrentUser() user: CurrentUserPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.getSession(user.adminSessionId!);
    return {
      ...result,
      csrfToken: reply.generateCsrf(),
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @AdminAuth()
  @ApiOperation({ summary: '撤销当前管理员会话' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.logout(user.adminSessionId!, fingerprint(request));
    reply.clearCookie(adminSessionCookieName(this.production), { path: '/api/v1/admin' });
    return result;
  }

  @Post('step-up/challenge')
  @HttpCode(HttpStatus.OK)
  @AdminAuth()
  @Throttle({ default: { ttl: 60_000, limit: 1 } })
  @ApiOperation({ summary: '为高风险站务操作发送邮箱确认码' })
  @ApiOkResponse({ type: AdminChallengeResponseDto })
  stepUpChallenge(@CurrentUser() user: CurrentUserPayload, @Req() request: FastifyRequest) {
    return this.auth.createStepUpChallenge(user.id, fingerprint(request));
  }

  @Post('step-up/verify')
  @HttpCode(HttpStatus.OK)
  @AdminAuth()
  @ApiOperation({ summary: '确认高风险操作，10 分钟内免重复验证' })
  @ApiOkResponse({ type: AdminStepUpResponseDto })
  verifyStepUp(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AdminChallengeVerifyDto,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.verifyStepUp(
      user.adminSessionId!,
      user.id,
      dto.challengeId,
      dto.code,
      fingerprint(request),
    );
  }
}
