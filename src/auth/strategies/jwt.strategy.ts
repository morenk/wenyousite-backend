import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

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

  /** 验证通过后，将用户信息挂载到 request.user */
  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true, emailVerified: true, deletedAt: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.deletedAt) {
      throw new UnauthorizedException('账号已注销');
    }
    return user;
  }
}
