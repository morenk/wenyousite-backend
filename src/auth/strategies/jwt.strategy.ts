import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { unauthorized } from '../../common/exceptions/business.exception';
import { activeSanctionWhere, sanctionFailure } from '../../access/account-status';

/** JWT 策略：从 Authorization header 提取并验证 accessToken，从 DB 加载用户 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      // 从 Bearer Token 中提取 JWT
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret')!,
    });
  }

  /** 验证通过后，将用户和稳定登录终端 ID 挂载到 request.user。 */
  async validate(payload: { sub: string; sid?: string }) {
    const [user, activeTerminal] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          username: true,
          avatar: true,
          role: true,
          deletedAt: true,
          sanctions: {
            where: activeSanctionWhere(),
            take: 1,
            select: { type: true, endsAt: true },
          },
        },
      }),
      payload.sid
        ? this.prisma.refreshToken.findFirst({
            where: {
              userId: payload.sub,
              family: payload.sid,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!user) {
      throw unauthorized('用户不存在', ErrorCode.TOKEN_INVALID);
    }
    if (user.deletedAt) {
      throw unauthorized('账号已注销', ErrorCode.ACCOUNT_DEACTIVATED);
    }
    const failure = sanctionFailure(user.sanctions?.[0]);
    if (failure) throw unauthorized(failure.message, failure.code);
    // 兼容部署前签发、最长仅存活 15 分钟的无 sid access token。
    if (payload.sid && !activeTerminal) {
      throw unauthorized('登录终端已失效，请重新登录', ErrorCode.TOKEN_REVOKED);
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      deletedAt: user.deletedAt,
      sessionId: payload.sid,
    };
  }
}
