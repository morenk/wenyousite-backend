import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ClientPlatform, normalizeClientPlatform } from './client-platform';
import { ErrorCode } from '../common/exceptions/error-codes';
import { unauthorized } from '../common/exceptions/business.exception';
import { activeSanctionWhere, sanctionFailure } from './account-sanction';

const userSelectPublic = {
  id: true,
  email: true,
  username: true,
  avatar: true,
  role: true,
  emailVerified: true,
  level: true,
} as const;

/**
 * 登录与刷新会锁定用户行来串行化同平台会话变更。Prisma 默认 5 秒事务时限
 * 会把等待行锁的时间也计算在内，短时数据库竞争可能因此在提交前误报 P2028。
 */
const SESSION_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 15_000,
} as const;

interface PreparedSession {
  userId: string;
  family: string;
  rawRefreshToken: string;
  tokenHash: string;
  platform: ClientPlatform;
  deviceInfo: string | null;
  sessionStartedAt: Date;
  expiresAt: Date;
}

/** 登录终端与令牌轮转用例。 */
@Injectable()
export class AuthSessionService {
  private readonly REFRESH_REPLAY_GRACE = 10 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private refreshTtl(platform: ClientPlatform): number {
    const days =
      platform === 'mobile'
        ? (this.configService.get<number>('jwt.refreshMobileTtlDays') ?? 30)
        : (this.configService.get<number>('jwt.refreshWebTtlDays') ?? 7);
    return days * 24 * 60 * 60 * 1000;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private prepareSession(
    userId: string,
    deviceInfo: string | null,
    platform: ClientPlatform,
  ): PreparedSession {
    const normalizedPlatform = normalizeClientPlatform(platform);
    const rawRefreshToken = crypto.randomUUID();
    return {
      userId,
      family: crypto.randomUUID(),
      rawRefreshToken,
      tokenHash: this.hashToken(rawRefreshToken),
      platform: normalizedPlatform,
      deviceInfo,
      sessionStartedAt: new Date(),
      expiresAt: new Date(Date.now() + this.refreshTtl(normalizedPlatform)),
    };
  }

  private async replaceSession(tx: Prisma.TransactionClient, session: PreparedSession) {
    await tx.refreshToken.updateMany({
      where: { userId: session.userId, platform: session.platform, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.refreshToken.create({
      data: {
        userId: session.userId,
        tokenHash: session.tokenHash,
        family: session.family,
        platform: session.platform,
        deviceInfo: session.deviceInfo,
        sessionStartedAt: session.sessionStartedAt,
        expiresAt: session.expiresAt,
      },
    });
  }

  private signAccessToken(userId: string, family: string) {
    return this.jwtService.signAsync(
      { sub: userId, sid: family },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );
  }

  /** 创建登录终端：同一用户同一平台只保留最新终端。用户行锁保证并发登录不会产生重复槽位。 */
  async createSession(userId: string, deviceInfo: string | null, platform: ClientPlatform = 'web') {
    const session = this.prepareSession(userId, deviceInfo, platform);
    const accessToken = await this.signAccessToken(userId, session.family);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const sanction = await tx.userSanction.findFirst({
        where: { userId, ...activeSanctionWhere() },
        select: { type: true, endsAt: true },
      });
      const failure = sanctionFailure(sanction);
      if (failure) throw unauthorized(failure.message, failure.code);
      await this.replaceSession(tx, session);
    }, SESSION_TRANSACTION_OPTIONS);

    return { accessToken, refreshToken: session.rawRefreshToken };
  }

  /** 登录：验证邮箱或用户名 + 密码，创建新会话（含 5 次失败锁定） */
  async login(dto: LoginDto, deviceInfo?: string, platform: ClientPlatform = 'web') {
    const account = dto.account.trim();
    const initial = await this.prisma.user.findFirst({
      where: {
        OR: [
          // 邮箱统一小写匹配；用户名大小写敏感精确匹配（与注册唯一约束一致）
          { email: account.toLowerCase() },
          { username: account },
        ],
      },
      select: { id: true },
    });
    if (!initial) {
      throw unauthorized('账号或密码错误', ErrorCode.LOGIN_FAILED);
    }

    const session = this.prepareSession(initial.id, deviceInfo ?? null, platform);
    const accessToken = await this.signAccessToken(initial.id, session.family);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.id} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id: initial.id },
        select: {
          ...userSelectPublic,
          password: true,
          deletedAt: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          sanctions: {
            where: activeSanctionWhere(),
            take: 1,
            select: { type: true, endsAt: true },
          },
        },
      });
      if (!user || user.deletedAt) {
        return { ok: false as const, message: '账号或密码错误', code: ErrorCode.LOGIN_FAILED };
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return {
          ok: false as const,
          message: '登录过于频繁，请稍后重试',
          code: ErrorCode.ACCOUNT_LOCKED,
        };
      }

      const valid = await argon2.verify(user.password, dto.password);
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
              message: '登录过于频繁，请稍后重试',
              code: ErrorCode.ACCOUNT_LOCKED,
            }
          : { ok: false as const, message: '账号或密码错误', code: ErrorCode.LOGIN_FAILED };
      }

      const sanction = sanctionFailure(user.sanctions?.[0]);
      if (sanction) return { ok: false as const, ...sanction };

      if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }
      await this.replaceSession(tx, session);
      return { ok: true as const, user };
    }, SESSION_TRANSACTION_OPTIONS);

    if (!result.ok) throw unauthorized(result.message, result.code);
    const user = result.user;

    return {
      accessToken,
      refreshToken: session.rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        emailVerified: user.emailVerified,
        level: user.level,
      },
    };
  }

  /** 刷新 Token：在用户行锁内轮转，和同平台新登录串行化。 */
  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const initial = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!initial) {
      throw unauthorized('刷新令牌无效', ErrorCode.TOKEN_INVALID);
    }

    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.userId} FOR UPDATE`;
      const record = await tx.refreshToken.findFirst({
        where: { tokenHash },
        include: {
          user: {
            select: {
              ...userSelectPublic,
              deletedAt: true,
              sanctions: {
                where: activeSanctionWhere(),
                take: 1,
                select: { type: true, endsAt: true },
              },
            },
          },
        },
      });

      if (!record) {
        return { ok: false as const, message: '刷新令牌无效', code: ErrorCode.TOKEN_INVALID };
      }

      const sanction = sanctionFailure(record.user.sanctions?.[0]);
      if (sanction) {
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, family: record.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: sanction.message, code: sanction.code };
      }

      if (record.revokedAt) {
        const outsideGrace = Date.now() - record.revokedAt.getTime() > this.REFRESH_REPLAY_GRACE;
        if (outsideGrace) {
          // 必须先提交吊销，再在事务外抛错；事务内抛错会回滚安全操作。
          await tx.refreshToken.updateMany({
            where: { userId: record.userId, family: record.family, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return {
          ok: false as const,
          message: outsideGrace ? '检测到刷新令牌重放，登录终端已退出' : '刷新令牌已被轮转',
          code: outsideGrace ? ErrorCode.TOKEN_THEFT_DETECTED : ErrorCode.TOKEN_REVOKED,
        };
      }

      if (record.expiresAt <= new Date()) {
        await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return {
          ok: false as const,
          message: '刷新令牌已过期，请重新登录',
          code: ErrorCode.TOKEN_EXPIRED,
        };
      }

      if (record.user.deletedAt) {
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, family: record.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: '账号已注销', code: ErrorCode.ACCOUNT_DEACTIVATED };
      }

      // 原子撤销：用 updateMany({ id, revokedAt: null }) 防并发竞争
      const revokeResult = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revokeResult.count === 0) {
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, family: record.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: '刷新令牌已被轮转', code: ErrorCode.TOKEN_REVOKED };
      }

      const newRawToken = crypto.randomUUID();
      const newHash = this.hashToken(newRawToken);
      const platform = normalizeClientPlatform(record.platform);
      const ttl = this.refreshTtl(platform);
      const expiresAt = new Date(Date.now() + ttl);

      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: newHash,
          family: record.family,
          platform,
          deviceInfo: record.deviceInfo,
          sessionStartedAt: record.sessionStartedAt,
          expiresAt,
        },
      });

      return {
        ok: true as const,
        newRawToken,
        platform,
        sessionId: record.family,
        userId: record.userId,
        user: record.user,
      };
    }, SESSION_TRANSACTION_OPTIONS);

    if (!rotated.ok) {
      throw unauthorized(rotated.message, rotated.code);
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: rotated.userId, sid: rotated.sessionId },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );

    return {
      accessToken,
      refreshToken: rotated.newRawToken,
      platform: rotated.platform,
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        username: rotated.user.username,
        avatar: rotated.user.avatar,
        role: rotated.user.role,
        emailVerified: rotated.user.emailVerified,
      },
    };
  }

  /** 登出：撤销当前登录终端的 refresh token */
  async logout(userId: string, rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: '已登出' };
  }

  /** 列出当前用户的 Web / 移动客户端活跃登录终端。 */
  async listSessions(userId: string, currentSessionId?: string, currentRefreshToken?: string) {
    const currentHash = currentRefreshToken ? this.hashToken(currentRefreshToken) : null;
    const now = new Date();
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: {
        family: true,
        platform: true,
        deviceInfo: true,
        sessionStartedAt: true,
        createdAt: true,
        expiresAt: true,
        tokenHash: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.family,
      platform: normalizeClientPlatform(s.platform),
      deviceInfo: s.deviceInfo,
      isCurrent:
        s.family === currentSessionId || (currentHash !== null && s.tokenHash === currentHash),
      signedInAt: s.sessionStartedAt,
      lastActiveAt: s.createdAt,
      expiresAt: s.expiresAt,
      createdAt: s.sessionStartedAt,
    }));
  }

  /** 退出指定登录终端；兼容旧客户端传 refresh token 记录 ID。 */
  async revokeSession(userId: string, sessionId: string) {
    const terminal = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        OR: [{ family: sessionId }, { id: sessionId }],
      },
      select: { family: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!terminal) {
      throw unauthorized('登录终端不存在或已失效', ErrorCode.SESSION_NOT_FOUND);
    }

    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, family: terminal.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw unauthorized('登录终端不存在或已失效', ErrorCode.SESSION_NOT_FOUND);
    }
    return { message: '登录终端已退出' };
  }
}
