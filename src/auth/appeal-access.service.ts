import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { unauthorized } from '../common/exceptions/business.exception';
import { PrismaService } from '../prisma/prisma.service';

const APPEAL_TOKEN_AUDIENCE = 'wenyou-moderation-appeal';
const APPEAL_TOKEN_ISSUER = 'wenyousite-api';
const APPEAL_TOKEN_PURPOSE = 'moderation-appeal';
export const APPEAL_TOKEN_TTL_SECONDS = 15 * 60;
const CREDENTIAL_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

interface AppealTokenPayload {
  sub: string;
  purpose: typeof APPEAL_TOKEN_PURPOSE;
}

interface AppealPrincipal {
  id: string;
  username: string;
  role: UserRole;
  emailVerified: boolean;
}

function tokenSecret(accessSecret: string): Buffer {
  return crypto
    .createHmac('sha256', accessSecret)
    .update('wenyousite:appeal-token:v1')
    .digest();
}

/** 签发并验证只能访问用户申诉接口的短期凭据。 */
@Injectable()
export class AppealAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(accountInput: string, password: string) {
    const user = await this.verifyCredentials(accountInput, password);
    if (!user.emailVerified) {
      throw unauthorized('请先完成邮箱验证', ErrorCode.EMAIL_NOT_VERIFIED);
    }

    const issuedAt = Date.now();
    const appealToken = await this.jwt.signAsync(
      { sub: user.id, purpose: APPEAL_TOKEN_PURPOSE } satisfies AppealTokenPayload,
      {
        secret: this.secret(),
        audience: APPEAL_TOKEN_AUDIENCE,
        issuer: APPEAL_TOKEN_ISSUER,
        expiresIn: APPEAL_TOKEN_TTL_SECONDS,
        jwtid: crypto.randomUUID(),
      },
    );

    return {
      appealToken,
      expiresAt: new Date(issuedAt + APPEAL_TOKEN_TTL_SECONDS * 1000),
    };
  }

  isAppealToken(token: string): boolean {
    try {
      const payload = this.jwt.decode(token);
      return Boolean(
        payload &&
          typeof payload === 'object' &&
          payload['purpose'] === APPEAL_TOKEN_PURPOSE,
      );
    } catch {
      return false;
    }
  }

  async authenticate(token: string): Promise<AppealPrincipal> {
    let payload: AppealTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AppealTokenPayload>(token, {
        secret: this.secret(),
        audience: APPEAL_TOKEN_AUDIENCE,
        issuer: APPEAL_TOKEN_ISSUER,
      });
    } catch {
      throw unauthorized('申诉访问令牌无效或已过期', ErrorCode.APPEAL_TOKEN_INVALID);
    }
    if (payload.purpose !== APPEAL_TOKEN_PURPOSE || !payload.sub) {
      throw unauthorized('申诉访问令牌无效或已过期', ErrorCode.APPEAL_TOKEN_INVALID);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        role: true,
        emailVerified: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt || !user.emailVerified) {
      throw unauthorized('申诉访问令牌无效或已过期', ErrorCode.APPEAL_TOKEN_INVALID);
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      emailVerified: user.emailVerified,
    };
  }

  private async verifyCredentials(accountInput: string, password: string): Promise<AppealPrincipal> {
    const account = accountInput.trim();
    const initial = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: account.toLowerCase() }, { username: account }],
      },
      select: { id: true },
    });
    if (!initial) throw unauthorized('账号或密码错误', ErrorCode.LOGIN_FAILED);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.id} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: initial.id },
        select: {
          id: true,
          username: true,
          role: true,
          emailVerified: true,
          password: true,
          deletedAt: true,
          failedLoginAttempts: true,
          lockedUntil: true,
        },
      });
      if (!user || user.deletedAt) {
        return { ok: false as const, code: ErrorCode.LOGIN_FAILED, message: '账号或密码错误' };
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return {
          ok: false as const,
          code: ErrorCode.ACCOUNT_LOCKED,
          message: '登录过于频繁，请稍后重试',
        };
      }

      const valid = await argon2.verify(user.password, password);
      if (!valid) {
        const attempts = user.failedLoginAttempts + 1;
        const locked = attempts >= 5;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: attempts,
            ...(locked ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
          },
        });
        return locked
          ? {
              ok: false as const,
              code: ErrorCode.ACCOUNT_LOCKED,
              message: '登录过于频繁，请稍后重试',
            }
          : { ok: false as const, code: ErrorCode.LOGIN_FAILED, message: '账号或密码错误' };
      }

      if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }
      return { ok: true as const, user };
    }, CREDENTIAL_TRANSACTION_OPTIONS);

    if (!result.ok) throw unauthorized(result.message, result.code);
    return {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
      emailVerified: result.user.emailVerified,
    };
  }

  private secret(): Buffer {
    return tokenSecret(this.config.get<string>('jwt.accessSecret')!);
  }
}
